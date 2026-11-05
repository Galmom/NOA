import test from 'node:test';
import assert from 'node:assert/strict';
import { createCameraLink } from '../src/camera.js';

test('camera starts disconnected', () => {
  const cam = createCameraLink();
  assert.equal(cam.connected, false);
});

test('captureSnapshot rejects when offline', async () => {
  const cam = createCameraLink();
  await assert.rejects(cam.captureSnapshot(), /camera offline/);
});

