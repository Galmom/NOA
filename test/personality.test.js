import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackReply } from '../src/personality.js';

test('fallback: local outage explains the local brain is missing', () => {
  const text = fallbackReply('local');
  assert.ok(text.length > 0, 'must say something');
  assert.match(text, /local/i);
});

test('fallback: cloud outage points at the network, not the local model', () => {
  const text = fallbackReply('cloud');
  assert.ok(text.length > 0, 'must say something');
  assert.match(text, /nube/i);
  assert.doesNotMatch(text, /local/i);
});
