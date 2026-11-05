import test from 'node:test';
import assert from 'node:assert/strict';

import { buildHistory, isCanned } from '../src/history.js';

const turns = (...pairs) =>
  pairs.flatMap(([role, content]) => [{ role, content }]);

test('history keeps only the last few turns', () => {
  const rows = turns(
    ['user', 'uno'], ['assistant', 'a1'],
    ['user', 'dos'], ['assistant', 'a2'],
    ['user', 'tres'], ['assistant', 'a3'],
    ['user', 'cuatro'], ['assistant', 'a4'],
  );

  const history = buildHistory(rows, { limit: 4 });
  assert.deepEqual(history.map((row) => row.content), ['tres', 'a3', 'cuatro', 'a4']);
});

test('history drops canned fallbacks so the robot does not echo them', () => {
  assert.equal(isCanned('No me responde el cerebro local todavía.'), true);
  assert.equal(isCanned('[stub:local] hola'), true);

  const rows = turns(
    ['user', 'hola'],
    ['assistant', 'No me responde el cerebro local todavía.'],
    ['user', 'y ahora?'],
    ['assistant', 'Ahora sí, soy Wall-E.'],
  );

  const history = buildHistory(rows);
  assert.deepEqual(history.map((row) => row.content), ['hola', 'y ahora?', 'Ahora sí, soy Wall-E.']);
});

test('history respects the character budget by dropping the oldest turns first', () => {
  const rows = turns(
    ['user', 'x'.repeat(300)],
    ['assistant', 'y'.repeat(300)],
    ['user', 'ultima'],
  );

  const history = buildHistory(rows, { maxChars: 320, perMessageChars: 300 });
  // 300 + 6 fits in 320, so only the oldest turn is evicted.
  assert.deepEqual(history.map((row) => row.content), ['y'.repeat(300), 'ultima']);
});

test('history ignores empty and unknown roles', () => {
  const rows = turns(['user', ''], ['system', 'ignorame'], ['assistant', 'ok']);
  const history = buildHistory(rows);
  assert.deepEqual(history, [{ role: 'assistant', content: 'ok' }]);
});
