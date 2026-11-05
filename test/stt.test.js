import test from 'node:test';
import assert from 'node:assert/strict';
import { pcmToWav, createStt } from '../src/stt.js';

test('pcmToWav wraps PCM with a valid 44-byte RIFF header', () => {
  const pcm = Buffer.alloc(100, 0x12);
  const wav = pcmToWav(pcm, 16000, 1, 16);

  assert.equal(wav.length, 144);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(4), 136); // 36 + dataSize
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.toString('ascii', 12, 16), 'fmt ');
  assert.equal(wav.readUInt16LE(20), 1); // PCM format
  assert.equal(wav.readUInt16LE(22), 1); // 1 channel
  assert.equal(wav.readUInt32LE(24), 16000); // 16 kHz
  assert.equal(wav.readUInt16LE(34), 16); // 16 bits
  assert.equal(wav.toString('ascii', 36, 40), 'data');
  assert.equal(wav.readUInt32LE(40), 100);
});

test('createStt throws when API key is missing', async () => {
  const stt = createStt({ apiKey: '' });
  assert.equal(stt.configured, false);
  await assert.rejects(() => stt.transcribe(Buffer.alloc(10)), /missing API key/);
});

test('createStt sends multipart form to Whisper endpoint and parses response', async () => {
  let capturedUrl = '';
  let capturedAuth = '';

  const fakeFetch = async (url, options) => {
    capturedUrl = url;
    capturedAuth = options.headers.authorization;
    return {
      ok: true,
      json: async () => ({ text: 'hola wall-e' }),
    };
  };

  const stt = createStt({
    apiKey: 'gsk_test123',
    fetchImpl: fakeFetch,
  });

  assert.equal(stt.configured, true);
  const text = await stt.transcribe(Buffer.alloc(64));

  assert.equal(text, 'hola wall-e');
  assert.equal(capturedUrl, 'https://api.groq.com/openai/v1/audio/transcriptions');
  assert.equal(capturedAuth, 'Bearer gsk_test123');
});

