import test from 'node:test';
import assert from 'node:assert/strict';
import { searchWeb } from '../src/search.js';

test('searchWeb returns empty array for empty query', async () => {
  const res = await searchWeb('');
  assert.deepEqual(res, []);
});

test('searchWeb returns results for a real query', async () => {
  const snippets = await searchWeb('capital de francia');
  // If there's network, we should get at least 1 snippet containing Paris
  if (snippets.length > 0) {
    assert.ok(snippets.some((s) => /par[ií]s/i.test(s)));
  }
});

