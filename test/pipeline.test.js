import test from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../src/pipeline.js';
import { createTools, createToolset } from '../src/toolset.js';

// Minimal mock memory so createTools can instantiate the memoryTool.
const memory = {
  getFact: (key) => (key === 'owner_name' ? 'Juan' : null),
  setFact: () => {},
};
const toolset = createToolset(createTools({ memory }));

const cases = [
  // [input, expected kind]
  ['que hora es?', 'tool'],
  ['que hora es en tokio?', 'tool'],
  ['cuanto es 847 por 2391?', 'tool'],
  ['cuanto es el 10% de 500?', 'tool'],
  ['como esta el clima?', 'cloud'],
  ['va a llover hoy?', 'cloud'],
  ['quien gano el partido de ayer?', 'cloud'],
  ['cuanto salio boca?', 'cloud'],
  ['a cuanto esta el dolar?', 'cloud'],
  ['quien fue san martin?', 'cloud'],
  ['que es la fotosintesis?', 'cloud'],
  ['como funciona un motor paso a paso?', 'cloud'],
  ['hola noa', 'cloud'],
  ['contame un chiste', 'cloud'],
  ['quien soy?', 'tool'],
  ['avanza dos metros', 'tool'],
  ['prende la luz', 'tool'],
];

for (const [input, expected] of cases) {
  test(`plan: ${input}`, () => {
    const result = plan(input, { toolset });
    assert.equal(result.kind, expected, `expected ${expected}, got ${result.kind} (${result.reason})`);
  });
}

test('a question about a match date is not stolen by the clock', () => {
  // A question that mentions "partido" belongs to realtime / cloud
  const result = plan('cuando es el proximo partido?', { toolset });
  assert.equal(result.kind, 'cloud');
});

test('a physical command is never answered as conversation, even with weather', () => {
  const result = plan('avanza dos metros aunque llueva', { toolset });
  assert.equal(result.kind, 'tool');
  assert.equal(result.tool.name, 'move');
});

test('an empty sentence goes nowhere', () => {
  assert.equal(plan('', { toolset }).kind, 'ignore');
  assert.equal(plan('   ', { toolset }).kind, 'ignore');
});
