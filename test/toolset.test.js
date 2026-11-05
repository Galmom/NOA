import test from 'node:test';
import assert from 'node:assert/strict';

import { createToolset, createTools, MAX_DISTANCE_M } from '../src/toolset.js';

process.env.BRAIN_TZ = 'America/Argentina/Buenos_Aires';

const noFacts = { getFact: () => null };

function build(memory = noFacts) {
  return createToolset(createTools({ memory }));
}

test('clock answers through the contract, without a model', async () => {
  const outcome = await build().dispatch('que hora es?');

  assert.equal(outcome.status, 'answered');
  assert.equal(outcome.tool, 'clock');
  assert.match(outcome.text, /^Son las \d{2}:\d{2}\.$/);
});

test('math answers exact arithmetic', async () => {
  const outcome = await build().dispatch('cuanto es 847 por 2391?');

  assert.equal(outcome.status, 'answered');
  assert.equal(outcome.text, 'Son 2.025.177.');
});

test('math understands a percentage, which used to fall to the model', async () => {
  const outcome = await build().dispatch('cuanto es el 10% de 500?');

  assert.equal(outcome.status, 'answered');
  assert.equal(outcome.tool, 'math');
  assert.equal(outcome.text, 'Son 50.');
});

test('memory answers the owner name it was told', async () => {
  const memory = {
    getFact: (key) => (key === 'owner_name' ? 'Lucas' : null),
  };

  const outcome = await build(memory).dispatch('quien soy?');

  assert.equal(outcome.status, 'answered');
  assert.equal(outcome.tool, 'memory');
  assert.equal(outcome.text, 'Te llamás Lucas.');
});

test('memory admits it does not know instead of inventing a name', async () => {
  const outcome = await build().dispatch('quien soy?');

  assert.equal(outcome.status, 'answered');
  assert.equal(outcome.text, 'Todavía no sé tu nombre.');
});

test('move returns a proposal and never an answer', async () => {
  const outcome = await build().dispatch('avanza dos metros');

  assert.equal(outcome.status, 'proposal');
  assert.equal(outcome.tool, 'move');
  assert.deepEqual(outcome.proposal, {
    action: 'move',
    direction: 'forward',
    distance_m: 2,
  });
});

test('move reads centimetres', async () => {
  const outcome = await build().dispatch('retrocede 35 cm');

  assert.equal(outcome.status, 'proposal');
  assert.deepEqual(outcome.proposal, {
    action: 'move',
    direction: 'backward',
    distance_m: 0.35,
  });
});

test('move without a distance asks instead of choosing one', async () => {
  const outcome = await build().dispatch('avanza');

  // Guessing "some distance" is the brain deciding how far a robot moves.
  assert.equal(outcome.status, 'invalid');
  assert.equal(outcome.reason, 'no_distance');
});

test('move refuses a distance beyond what the brain may request', async () => {
  const outcome = await build().dispatch(`avanza ${MAX_DISTANCE_M + 1} metros`);

  assert.equal(outcome.status, 'invalid');
  assert.equal(outcome.reason, 'too_far');
});

test('light proposal carries the requested state', async () => {
  const on = await build().dispatch('prende la luz');
  const off = await build().dispatch('apaga la luz');

  assert.deepEqual(on.proposal, { action: 'light', state: 'on' });
  assert.deepEqual(off.proposal, { action: 'light', state: 'off' });
});

test('light refuses an ambiguous state', async () => {
  const outcome = await build().dispatch('prende y apaga la luz');

  assert.equal(outcome.status, 'invalid');
  assert.equal(outcome.reason, 'no_state');
});

test('a body command beats a clock question sharing the sentence', async () => {
  const text = 'que hora es, avanza un metro';
  const toolset = build();

  const [first] = toolset.match(text);
  assert.equal(first.name, 'clock');

  // Match order would pick the clock. The pipeline forces the body tool, because
  // a motor command cannot be answered with small talk.
  const forced = await toolset.dispatch(text, { tool: toolset.firstBody(text) });
  assert.equal(forced.status, 'proposal');
  assert.equal(forced.tool, 'move');
});

test('validate runs before run, so a rejected command has no side effect', async () => {
  let ran = 0;

  const toolset = createToolset([
    {
      name: 'guarded',
      risk: 'read',
      asks: /hola/,
      validate: () => ({ ok: false, reason: 'nope' }),
      run: () => {
        ran += 1;
        return 'nunca';
      },
    },
  ]);

  const outcome = await toolset.dispatch('hola');

  assert.equal(outcome.status, 'invalid');
  assert.equal(ran, 0);
});

test('a hung tool is abandoned instead of holding the conversation', async () => {
  const toolset = createToolset([
    {
      name: 'slow',
      risk: 'read',
      asks: /espera/,
      timeout: 20,
      run: () => new Promise(() => {}),
    },
  ]);

  const outcome = await toolset.dispatch('espera');

  assert.equal(outcome.status, 'timeout');
});
