import test from 'node:test';
import assert from 'node:assert/strict';

import { createCloudClient } from '../src/cloud.js';

const PROVIDERS = [
  { name: 'primero', baseUrl: 'https://uno/v1', model: 'm1', apiKey: 'k1' },
  { name: 'segundo', baseUrl: 'https://dos/v1', model: 'm2', apiKey: 'k2' },
];

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { impl, calls };
}

const ok = (content) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }] }),
  text: async () => '',
});

const fail = (status) => ({
  ok: false,
  status,
  json: async () => ({}),
  text: async () => 'detalle',
});

test('cloud answers with the first provider when it works', async () => {
  const { impl, calls } = fakeFetch([ok('hola')]);
  const client = createCloudClient({ providers: PROVIDERS, fetchImpl: impl });

  const result = await client.complete([{ role: 'user', content: 'hola' }]);

  assert.deepEqual(result, { text: 'hola', provider: 'primero' });
  assert.equal(calls[0].url, 'https://uno/v1/chat/completions');
  assert.equal(calls[0].body.model, 'm1');
  assert.equal(calls[0].headers.authorization, 'Bearer k1');
});

test('cloud rotates to the next provider when the first runs out of quota', async () => {
  const { impl, calls } = fakeFetch([fail(429), ok('desde el segundo')]);
  const client = createCloudClient({ providers: PROVIDERS, fetchImpl: impl });

  const result = await client.complete([{ role: 'user', content: 'hola' }]);

  assert.deepEqual(result, { text: 'desde el segundo', provider: 'segundo' });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://dos/v1/chat/completions');
});

test('cloud remembers the provider that ran out and skips it next time', async () => {
  const { impl, calls } = fakeFetch([fail(429), ok('uno'), ok('dos')]);
  const client = createCloudClient({ providers: PROVIDERS, fetchImpl: impl });

  await client.complete([{ role: 'user', content: 'a' }]);
  const second = await client.complete([{ role: 'user', content: 'b' }]);

  assert.equal(second.provider, 'segundo');
  // 429 attempt + success, then straight to the provider that worked.
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url, 'https://dos/v1/chat/completions');
});

test('cloud reports every failure when no provider answers', async () => {
  const { impl } = fakeFetch([fail(429), fail(500)]);
  const client = createCloudClient({ providers: PROVIDERS, fetchImpl: impl });

  await assert.rejects(
    () => client.complete([{ role: 'user', content: 'hola' }]),
    /every cloud provider failed/,
  );
});

test('cloud fails clearly when nothing is configured', async () => {
  const client = createCloudClient({ providers: [], fetchImpl: async () => ok('x') });

  assert.equal(client.configured, false);
  await assert.rejects(
    () => client.complete([{ role: 'user', content: 'hola' }]),
    /no cloud provider is available right now/,
  );
});

test('cloud treats an empty completion as a failure and moves on', async () => {
  const { impl, calls } = fakeFetch([ok('   '), ok('buena')]);
  const client = createCloudClient({ providers: PROVIDERS, fetchImpl: impl });

  const result = await client.complete([{ role: 'user', content: 'hola' }]);

  assert.equal(result.text, 'buena');
  assert.equal(calls.length, 2);
});

test('cloud gives up on a hanging provider and tries the next one', async () => {
  // A saturated free tier does not answer with an error: it answers with
  // silence, and holds the connection open. That is the failure mode that used
  // to freeze the robot for 45 seconds.
  const calls = [];
  const impl = async (url, init) => {
    calls.push(url);
    if (calls.length === 1) {
      return new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted by timeout')));
      });
    }
    return ok('desde el segundo');
  };

  const client = createCloudClient({ providers: PROVIDERS, fetchImpl: impl });
  const result = await client.complete([{ role: 'user', content: 'hola' }], { timeoutMs: 20 });

  assert.equal(result.provider, 'segundo');
  assert.equal(result.text, 'desde el segundo');
  assert.equal(calls.length, 2);
});

test('cloud stops trying once the whole-question budget is spent', async () => {
  // Every provider hangs. The last one must not be started after the budget is
  // gone, or a five-provider pool becomes a four-minute wait.
  let clock = 0;
  const calls = [];
  const impl = async (url, init) => {
    calls.push(url);
    clock += 20000;
    return new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted by timeout')));
    });
  };

  const client = createCloudClient({
    providers: PROVIDERS,
    fetchImpl: impl,
    now: () => clock,
  });

  await assert.rejects(
    () => client.complete([{ role: 'user', content: 'hola' }], { timeoutMs: 5, budgetMs: 25000 }),
    /every cloud provider failed/,
  );

  // One attempt used 20s of a 25s budget: the second starts, then the budget is
  // gone and there is nothing left to try.
  assert.equal(calls.length, 2);
});
