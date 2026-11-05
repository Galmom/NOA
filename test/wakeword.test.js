import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWakeWord } from '../src/wakeword.js';

test('detects NOA variants at the start of sentence', () => {
  assert.deepEqual(extractWakeWord('Noa, ¿qué hora es?'), {
    addressed: true,
    cleanText: '¿qué hora es?',
  });

  assert.deepEqual(extractWakeWord('Che Noa qué hora es'), {
    addressed: true,
    cleanText: 'qué hora es',
  });

  assert.deepEqual(extractWakeWord('N.O.A. prende la luz'), {
    addressed: true,
    cleanText: 'prende la luz',
  });

  assert.deepEqual(extractWakeWord('Noah, cuando viene el papa?'), {
    addressed: true,
    cleanText: 'cuando viene el papa?',
  });

  assert.deepEqual(extractWakeWord('Hola Noa'), {
    addressed: true,
    cleanText: 'hola',
  });

  assert.deepEqual(extractWakeWord('Hola, Noah.'), {
    addressed: true,
    cleanText: 'hola',
  });
});

test('ignores ambient conversation not addressing NOA', () => {
  assert.deepEqual(extractWakeWord('Sí, es cierto que depende del día, pero...'), {
    addressed: false,
    cleanText: 'Sí, es cierto que depende del día, pero...',
  });

  assert.deepEqual(extractWakeWord('¿Qué cosa?'), {
    addressed: false,
    cleanText: '¿Qué cosa?',
  });

  assert.deepEqual(extractWakeWord('ahora'), {
    addressed: false,
    cleanText: 'ahora',
  });

  assert.deepEqual(extractWakeWord('a que hora es'), {
    addressed: false,
    cleanText: 'a que hora es',
  });

  assert.deepEqual(extractWakeWord('Gracias, Noah.'), {
    addressed: false,
    cleanText: 'Gracias, Noah.',
  });

  assert.deepEqual(extractWakeWord('La Noa viene mañana'), {
    addressed: false,
    cleanText: 'La Noa viene mañana',
  });

  assert.deepEqual(extractWakeWord('Te dije que Noa venga'), {
    addressed: false,
    cleanText: 'Te dije que Noa venga',
  });
});
