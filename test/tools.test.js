import test from 'node:test';
import assert from 'node:assert/strict';

import { answerClock, answerMath, formatDate, formatTime, FOREIGN_TIME_ANSWER } from '../src/tools.js';

// A fixed instant so the assertions never depend on when the suite runs.
// 2026-11-02T21:42:00Z is 18:42 in Buenos Aires (UTC-3).
const NOW = new Date('2026-11-02T21:42:00Z');

process.env.TZ = 'America/Argentina/Buenos_Aires';
process.env.BRAIN_TZ = 'America/Argentina/Buenos_Aires';

test('clock answers the time in local Spanish format', () => {
  assert.equal(answerClock('que hora es?', NOW), 'Son las 18:42.');
});

test('clock answers the date spelled out', () => {
  assert.equal(answerClock('que dia es hoy?', NOW), 'Hoy es lunes 2 de noviembre de 2026.');
});

test('clock answers both when asked for both', () => {
  assert.equal(
    answerClock('me decis la hora y la fecha?', NOW),
    'Son las 18:42, del lunes 2 de noviembre de 2026.',
  );
});

test('clock ignores questions it does not own', () => {
  // Asking for advice about a time is a conversation, not a clock lookup.
  assert.equal(answerClock('que hora te parece mejor para dormir?', NOW), null);
  assert.equal(answerClock('contame algo de vos', NOW), null);
  assert.equal(answerClock('', NOW), null);
  assert.equal(answerClock(null, NOW), null);
});

test('clock refuses to answer another city with this device timezone', () => {
  // Answering 18:42 for Tokyo would be the same confident lie as miscalculating.
  assert.equal(answerClock('que hora es en tokio?', NOW), FOREIGN_TIME_ANSWER);
  assert.equal(answerClock('que hora es en madrid', NOW), FOREIGN_TIME_ANSWER);
});

test('clock still answers when the place shares its timezone', () => {
  assert.equal(answerClock('que hora es en argentina?', NOW), 'Son las 18:42.');
  assert.equal(answerClock('que hora es aca?', NOW), 'Son las 18:42.');
});

test('formatters are stable for a known instant', () => {
  assert.equal(formatTime(NOW), '18:42');
  assert.equal(formatDate(NOW), 'lunes 2 de noviembre de 2026');
});

// Arithmetic is the other thing a language model must never answer. The local
// 1.5B said 847 por 2391 era 203.564,77; the real answer is 2.025.177. A
// calculator is cheaper, instant and never lies.
test('math solves multiplication written with the word "por"', () => {
  assert.equal(answerMath('cuanto es 847 por 2391?'), 'Son 2.025.177.');
});

test('math solves the basic operations written in Spanish', () => {
  assert.equal(answerMath('2 mas 2'), 'Son 4.');
  assert.equal(answerMath('10 menos 3'), 'Son 7.');
  assert.equal(answerMath('10 dividido 4'), 'Son 2,5.');
});

test('math respects precedence', () => {
  assert.equal(answerMath('2 mas 3 por 4'), 'Son 14.');
});

test('math handles symbols and accents too', () => {
  assert.equal(answerMath('cuánto es 6 × 7'), 'Son 42.');
  assert.equal(answerMath('847 * 2391'), 'Son 2.025.177.');
});

test('math refuses to divide by zero instead of inventing infinity', () => {
  assert.equal(answerMath('5 dividido 0'), 'No se puede dividir por cero.');
});

test('math declines anything that is not a pure expression', () => {
  // The strictness is the point: a partial parse is a wrong answer with a
  // confident voice, which is exactly what this tool exists to prevent.
  assert.equal(answerMath('que es la fotosintesis'), null);
  assert.equal(answerMath('cuanto es el dolar'), null);
  assert.equal(answerMath('tengo 5 pesos'), null);
  assert.equal(answerMath('2 mas 3 personas'), null);
  assert.equal(answerMath(''), null);
  assert.equal(answerMath(null), null);
});
