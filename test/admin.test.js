import test from 'node:test';
import assert from 'node:assert/strict';

import { startAdmin } from '../src/admin.js';

const TOKEN = 'secreto-de-prueba';

async function withServer(t, options, run) {
  let restarts = 0;
  const server = startAdmin({
    port: 0,
    token: TOKEN,
    onRestart: () => {
      restarts += 1;
    },
    onStatus: () => ({ ok: true, target: 'local' }),
    ...options,
  });

  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  await run({ base, restarts: () => restarts });
}

test('admin rejects a restart without the token', async (t) => {
  await withServer(t, {}, async ({ base, restarts }) => {
    const res = await fetch(`${base}/restart`, { method: 'POST' });
    assert.equal(res.status, 401);
    assert.equal(restarts(), 0);
  });
});

test('admin rejects a restart with the wrong token', async (t) => {
  await withServer(t, {}, async ({ base, restarts }) => {
    const res = await fetch(`${base}/restart`, {
      method: 'POST',
      headers: { 'x-brain-token': 'otro' },
    });
    assert.equal(res.status, 401);
    assert.equal(restarts(), 0);
  });
});

test('admin acknowledges a restart before exiting', async (t) => {
  await withServer(t, {}, async ({ base, restarts }) => {
    const res = await fetch(`${base}/restart`, {
      method: 'POST',
      headers: { 'x-brain-token': TOKEN },
    });

    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { ok: true, action: 'restarting' });
  });
});

test('admin refuses to restart when no token is configured', async (t) => {
  await withServer(t, { token: '' }, async ({ base, restarts }) => {
    const res = await fetch(`${base}/restart`, {
      method: 'POST',
      headers: { 'x-brain-token': '' },
    });
    assert.equal(res.status, 401);
    assert.equal(restarts(), 0);
  });
});

test('admin status reports the current tier', async (t) => {
  await withServer(t, {}, async ({ base }) => {
    const res = await fetch(`${base}/status`, {
      method: 'POST',
      headers: { 'x-brain-token': TOKEN },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, target: 'local' });
  });
});
