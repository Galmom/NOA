import test from 'node:test';
import assert from 'node:assert/strict';

import { parseProviders, cooldownFor, createPool } from '../src/providers.js';

const SAMPLE = `# proveedores free, uno por linea
# nombre | base_url | modelo | api_key

groq | https://api.groq.com/openai/v1 | llama-3.3-70b-versatile | gsk_uno
gemini|https://generativelanguage.googleapis.com/v1beta/openai/|gemini-2.0-flash|AIza_dos

# openrouter | https://openrouter.ai/api/v1 | meta-llama/llama-3.3-70b-instruct:free | sk-or-tres
`;

test('parses one provider per line and ignores comments and blanks', () => {
  const providers = parseProviders(SAMPLE);
  assert.equal(providers.length, 2);
  assert.deepEqual(providers[0], {
    name: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    apiKey: 'gsk_uno',
  });
});

test('strips trailing slashes so the endpoint path never doubles up', () => {
  const [, gemini] = parseProviders(SAMPLE);
  assert.equal(gemini.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
});

test('skips lines that are missing a field', () => {
  const providers = parseProviders('groq|https://x/v1|modelo\nbasura\n|||');
  assert.deepEqual(providers, []);
});

test('a quota failure rests longer than a transient one', () => {
  assert.ok(cooldownFor({ status: 429 }) > cooldownFor({ status: 500 }));
  assert.ok(cooldownFor({ status: 401 }) >= cooldownFor({ status: 429 }));
});

test('pool prefers the provider that last answered', () => {
  const now = () => 1000;
  const pool = createPool(
    [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
    { now },
  );

  assert.deepEqual(pool.order().map((p) => p.name), ['a', 'b', 'c']);
  pool.reportSuccess('c');
  assert.deepEqual(pool.order().map((p) => p.name), ['c', 'a', 'b']);
});

test('pool skips a provider until its cooldown expires', () => {
  let clock = 0;
  const pool = createPool(
    [{ name: 'a' }, { name: 'b' }],
    { now: () => clock },
  );

  pool.reportFailure('a', { status: 429 });
  assert.deepEqual(pool.order().map((p) => p.name), ['b']);

  clock += 16 * 60 * 1000;
  assert.deepEqual(pool.order().map((p) => p.name), ['a', 'b']);
});

test('pool reports nothing to try when every provider is resting', () => {
  const pool = createPool([{ name: 'a' }], { now: () => 0 });
  pool.reportFailure('a', { status: 429 });
  assert.deepEqual(pool.order(), []);
  assert.equal(pool.configured, true);
});

test('pool status exposes what is resting and for how long', () => {
  const pool = createPool([{ name: 'a' }, { name: 'b' }], { now: () => 0 });
  pool.reportFailure('a', { status: 429 });
  const [a, b] = pool.status();

  assert.equal(a.resting, true);
  assert.equal(a.resumesInSeconds, 900);
  assert.equal(b.resting, false);
});

test('two lines on the same gateway and key rest together', () => {
  // The real case: `openrouter` and `openrouter-auto` are the same account with
  // two model slugs. If one hits the quota, so did the other.
  const pool = createPool(
    [
      { name: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-uno' },
      { name: 'openrouter-auto', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-uno' },
      { name: 'groq', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'gsk' },
    ],
    { now: () => 0 },
  );

  assert.equal(pool.independent, 2);

  const [first] = pool.order();
  assert.equal(first.name, 'openrouter');
  pool.reportFailure(first, { status: 429 });

  // Not "openrouter-auto": that would be the same exhausted account again.
  assert.deepEqual(pool.order().map((p) => p.name), ['groq']);
});

test('two different keys on the same gateway are still independent', () => {
  const pool = createPool(
    [
      { name: 'groq-uno', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'gsk_1' },
      { name: 'groq-dos', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'gsk_2' },
    ],
    { now: () => 0 },
  );

  assert.equal(pool.independent, 2);
  pool.reportFailure(pool.order()[0], { status: 429 });
  assert.deepEqual(pool.order().map((p) => p.name), ['groq-dos']);
});

test('status shows which entries share one account', () => {
  const pool = createPool(
    [
      { name: 'a', baseUrl: 'https://x/v1', apiKey: 'k' },
      { name: 'b', baseUrl: 'https://x/v1', apiKey: 'k' },
    ],
    { now: () => 0 },
  );

  const [a, b] = pool.status();
  assert.equal(a.group, b.group);
  assert.equal(pool.independent, 1);
});

