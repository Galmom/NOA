import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BODY_OFFLINE,
  BODY_TIMEOUT,
  createBodyLink,
  describeOutcome,
} from '../src/body.js';

function fakeSocket() {
  const sent = [];
  return {
    readyState: 1,
    sent,
    send(payload) {
      sent.push(JSON.parse(payload));
    },
  };
}

test('no body connected refuses instead of pretending', async () => {
  const link = createBodyLink();

  const result = await link.execute({ action: 'move', direction: 'forward', distance_m: 2 });

  assert.equal(result.accepted, false);
  assert.equal(result.executed, false);
  assert.equal(result.reason, BODY_OFFLINE);
});

test('a proposal is sent and the confirmation is what resolves', async () => {
  const link = createBodyLink({ timeoutMs: 500 });
  const socket = fakeSocket();
  link.attach(socket);

  const pending = link.execute({ action: 'move', direction: 'forward', distance_m: 2 });

  assert.deepEqual(socket.sent[0].command, {
    action: 'move',
    direction: 'forward',
    distance_m: 2,
  });

  const disclosed = link.handleMessage({
    type: 'body-result',
    id: socket.sent[0].id,
    accepted: true,
    executed: true,
    distance_m: 0.35,
    reason: 'obstacle_detected',
  });

  assert.equal(disclosed, true);
  assert.deepEqual(await pending, {
    accepted: true,
    executed: true,
    reason: 'obstacle_detected',
    distance_m: 0.35,
    state: null,
  });
});

test('a body cannot claim execution without acceptance', async () => {
  const link = createBodyLink({ timeoutMs: 500 });
  const socket = fakeSocket();
  link.attach(socket);

  const pending = link.execute({ action: 'light', state: 'on' });
  link.handleMessage({
    type: 'body-result',
    id: socket.sent[0].id,
    accepted: false,
    executed: true,
    state: 'on',
  });

  const result = await pending;
  assert.equal(result.accepted, false);
  assert.equal(result.executed, false);
  assert.equal(result.state, 'on');
});

test('a silent body times out and reports uncertainty', async () => {
  const link = createBodyLink({ timeoutMs: 20 });
  link.attach(fakeSocket());

  const result = await link.execute({ action: 'light', state: 'on' });

  assert.equal(result.executed, false);
  assert.equal(result.reason, BODY_TIMEOUT);
});

test('a disconnect fails in-flight commands immediately', async () => {
  const link = createBodyLink({ timeoutMs: 5000 });
  const socket = fakeSocket();
  link.attach(socket);

  const pending = link.execute({ action: 'light', state: 'on' });
  link.detach(socket);

  const result = await pending;
  assert.equal(result.executed, false);
  assert.equal(result.reason, BODY_OFFLINE);
  assert.equal(link.online, false);
});

test('the reply reports what moved, not what was requested', () => {
  const sentence = describeOutcome(
    { action: 'move', direction: 'forward', distance_m: 2 },
    { accepted: true, executed: true, reason: 'obstacle_detected', distance_m: 0.35, state: null },
  );

  assert.equal(sentence, 'Avancé 35 cm.');
});

test('a movement without a measured distance does not invent a number', () => {
  const sentence = describeOutcome(
    { action: 'move', direction: 'forward', distance_m: 2 },
    { accepted: true, executed: true, reason: null, distance_m: null, state: null },
  );

  assert.equal(sentence, 'El cuerpo dice que se movió, pero no me confirmó cuánto.');
  assert.doesNotMatch(sentence, /200|2 m/);
});

test('a blocked movement says why', () => {
  const sentence = describeOutcome(
    { action: 'move', direction: 'forward', distance_m: 2 },
    { accepted: true, executed: false, reason: 'obstacle_detected', distance_m: null, state: null },
  );

  assert.equal(sentence, 'No lo hice: hay un obstáculo.');
});

test('light reports the confirmed state', () => {
  const on = describeOutcome(
    { action: 'light', state: 'on' },
    { accepted: true, executed: true, reason: null, distance_m: null, state: 'on' },
  );
  const off = describeOutcome(
    { action: 'light', state: 'off' },
    { accepted: true, executed: true, reason: null, distance_m: null, state: 'off' },
  );

  assert.equal(on, 'La luz quedó prendida.');
  assert.equal(off, 'La luz quedó apagada.');
});

test('offline is said plainly, never as a completed action', () => {
  const sentence = describeOutcome(
    { action: 'light', state: 'on' },
    { accepted: false, executed: false, reason: BODY_OFFLINE, distance_m: null, state: null },
  );

  assert.equal(sentence, 'No lo hice: no tengo cuerpo conectado.');
});
