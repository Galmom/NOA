// The cloud tier as the robot uses it: try providers until one answers.
//
// Kept separate from llm.js so the failover can be tested with a fake fetch and
// a fake clock instead of real network calls and real waiting.

import { createPool } from './providers.js';

export function createCloudClient({ providers, fetchImpl, now = () => Date.now() }) {
  const pool = createPool(providers, { now });
  // Resolved lazily so a test can replace globalThis.fetch after the module loads.
  const doFetch = fetchImpl ?? ((...args) => fetch(...args));

  async function complete(messages, options = {}) {
    // Two clocks, because one is not enough. `timeoutMs` bounds a single
    // provider; `budgetMs` bounds the whole failover. Free tiers do not fail
    // fast, they hang: a saturated Gemini sat there for 45s. Without the budget,
    // five hanging providers would leave a person waiting four minutes for a
    // robot that should answer in five seconds.
    const { timeoutMs = 12000, budgetMs = 25000, maxTokens = 400 } = options;
    const deadline = now() + budgetMs;
    const attempts = [];

    for (const provider of pool.order()) {
      const remaining = deadline - now();
      if (remaining <= 0) {
        attempts.push('budget exhausted before reaching the rest');
        break;
      }

      try {
        const response = await doFetch(`${provider.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${provider.apiKey}`,
          },
          body: JSON.stringify({
            model: provider.model,
            messages,
            temperature: 0.7,
            max_tokens: maxTokens,
            stream: false,
          }),
          signal: AbortSignal.timeout(Math.min(timeoutMs, remaining)),
        });

        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          const error = new Error(`${provider.name} returned ${response.status}: ${detail.slice(0, 120)}`);
          error.status = response.status;
          throw error;
        }

        const payload = await response.json();
        const text = payload?.choices?.[0]?.message?.content;
        if (typeof text !== 'string' || text.trim().length === 0) {
          throw new Error(`${provider.name} returned an empty completion`);
        }

        pool.reportSuccess(provider);
        return { text: text.trim(), provider: provider.name };
      } catch (error) {
        pool.reportFailure(provider, error);
        attempts.push(error.message);
      }
    }

    if (attempts.length === 0) {
      throw new Error('no cloud provider is available right now');
    }
    throw new Error(`every cloud provider failed: ${attempts.join(' | ')}`);
  }

  return {
    complete,
    get configured() {
      return pool.configured;
    },
    /** Independent quotas behind the list, not the number of lines. */
    get independent() {
      return pool.independent;
    },
    status: () => pool.status(),
  };
}
