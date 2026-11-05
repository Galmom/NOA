import test from 'node:test';
import assert from 'node:assert/strict';
import { route } from '../src/router.js';

const cases = [
  // [input, expected target]
  // General conversation, realtime, search and code all route to cloud by default
  // for high-IQ reasoning (GPT-OSS 120B).
  ['hola noa', 'cloud'],
  ['contame un chiste', 'cloud'],
  ['avanza dos metros', 'cloud'],
  ['gira a la izquierda', 'cloud'],
  ['que hora es', 'cloud'],
  ['que fecha es hoy', 'cloud'],
  ['buscame el precio del dolar', 'cloud'],
  ['averigua quien gano el partido', 'cloud'],
  ['cuanto es 847 * 2391', 'cloud'],
  ['cuanto es 847 por 2391', 'cloud'],
  ['escribime una funcion en python', 'cloud'],
  ['como esta el clima', 'cloud'],
  ['va a llover hoy', 'cloud'],
  ['cuanto salio boca', 'cloud'],
];

for (const [input, expected] of cases) {
  test(`route: ${input}`, () => {
    const result = route(input);
    assert.equal(result.target, expected, `expected ${expected}, got ${result.target} (${result.reason})`);
    assert.ok(result.reason, 'route must explain itself');
  });
}

test('route: empty input is ignored', () => {
  assert.equal(route('').target, 'ignore');
  assert.equal(route('   ').target, 'ignore');
  assert.equal(route(null).target, 'ignore');
});

test('route: long text escalates to cloud', () => {
  const long = 'contame sobre la historia de la robotica '.repeat(20);
  assert.equal(route(long).target, 'cloud');
  assert.equal(route(long).reason, 'long');
});
