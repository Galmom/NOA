// A pool of free-tier providers that rotates when one runs out.
//
// The robot is offline-first and pays nothing, so the cloud tier is a set of
// free quotas rather than one paid account. When a provider answers 429 (quota
// exhausted) or 401 (dead key), the next request goes to the next provider
// instead of failing the user's question.
//
// File format, one provider per line, pipe separated:
//
//   nombre | base_url | modelo | api_key
//
// Anything after a `#` line is ignored, so the file can be documented in place.

/**
 * @param {string} text
 * @returns {{name: string, baseUrl: string, model: string, apiKey: string}[]}
 */
export function parseProviders(text) {
  const providers = [];

  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const parts = line.split('|').map((part) => part.trim());
    if (parts.length < 4) continue;

    const [name, baseUrl, model, apiKey] = parts;
    if (!name || !baseUrl || !model || !apiKey) continue;

    providers.push({
      name,
      baseUrl: baseUrl.replace(/\/+$/, ''),
      model,
      apiKey,
    });
  }

  return providers;
}

const QUOTA_COOLDOWN_MS = 15 * 60 * 1000;
const AUTH_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const TRANSIENT_COOLDOWN_MS = 2 * 60 * 1000;

/**
 * How long a provider rests after a failure, based on what kind of failure it was.
 * A quota is not worth retrying in a minute; a bad key is not worth retrying today.
 */
export function cooldownFor(error) {
  const status = error?.status;

  if (status === 401 || status === 403) return AUTH_COOLDOWN_MS;
  if (status === 402 || status === 429) return QUOTA_COOLDOWN_MS;
  return TRANSIENT_COOLDOWN_MS;
}

import { createHash } from 'node:crypto';

/**
 * Identity of the quota behind an entry, not of the entry itself.
 *
 * Two lines that share a gateway AND a key are one account: when that account
 * runs out of quota, the second line is already out too. Counting them as two
 * independent backups is how you discover, during an outage, that your "5
 * providers" were really 4. Different keys on the same gateway are still
 * independent, because the quota is per key.
 *
 * The key is fingerprinted rather than embedded: this identifier is printed by
 * /status, and a status endpoint that echoes secrets is a leak with a friendly
 * name.
 * @param {{name?: string, baseUrl?: string, apiKey?: string}} provider
 */
export function providerGroup(provider) {
  if (!provider?.baseUrl) return provider?.name ?? '';
  const fingerprint = provider.apiKey
    ? createHash('sha256').update(provider.apiKey).digest('hex').slice(0, 10)
    : 'nokey';
  return `${provider.baseUrl}|${fingerprint}`;
}

/**
 * @param {{name: string}[]} providers
 * @param {{now?: () => number}} [options]
 */
export function createPool(providers, options = {}) {
  const now = options.now ?? (() => Date.now());
  const restingUntil = new Map();
  const byName = new Map(providers.map((provider) => [provider.name, provider]));
  let preferred = null;

  // Accepts either a provider or its name, so callers never have to know how
  // grouping works.
  const groupOf = (target) =>
    providerGroup(typeof target === 'string' ? (byName.get(target) ?? { name: target }) : target);

  const isResting = (provider) => (restingUntil.get(groupOf(provider)) ?? 0) > now();

  return {
    get configured() {
      return providers.length > 0;
    },

    /** How many genuinely independent quotas this list contains. */
    get independent() {
      return new Set(providers.map(groupOf)).size;
    },

    /** Providers to try, in order, with the last successful one first. */
    order() {
      const ready = providers.filter((provider) => !isResting(provider));
      if (ready.length === 0) return [];

      const chosen = ready.find((provider) => provider.name === preferred);
      if (!chosen) return ready;
      return [chosen, ...ready.filter((provider) => provider.name !== chosen.name)];
    },

    reportSuccess(target) {
      restingUntil.delete(groupOf(target));
      preferred = typeof target === 'string' ? target : target.name;
    },

    reportFailure(target, error) {
      restingUntil.set(groupOf(target), now() + cooldownFor(error));
      if (preferred === (typeof target === 'string' ? target : target.name)) preferred = null;
    },

    status() {
      const timestamp = now();
      return providers.map((provider) => {
        const group = groupOf(provider);
        const until = restingUntil.get(group) ?? 0;
        return {
          name: provider.name,
          // Exposed so a duplicated account is visible in /status instead of
          // hiding behind two different names.
          group,
          resting: until > timestamp,
          resumesInSeconds: until > timestamp ? Math.ceil((until - timestamp) / 1000) : 0,
          preferred: provider.name === preferred,
        };
      });
    },
  };
}
