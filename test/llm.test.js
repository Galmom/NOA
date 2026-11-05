import test from 'node:test';
import assert from 'node:assert/strict';

// The local tier must hit Ollama's native /api/chat and carry num_thread,
// because the /v1 surface ignores it and the default threading runs 20x slower
// on this SoC. These tests pin the wire format so a future refactor cannot
// quietly go back to the slow path.
process.env.BRAIN_STUB = '0';
process.env.LLM_LOCAL_URL = 'http://127.0.0.1:8080';
process.env.LLM_LOCAL_MODEL = 'qwen2.5:1.5b-instruct-q4_0';
process.env.LLM_LOCAL_THREADS = '5';
process.env.LLM_CLOUD_API_KEY = 'test-key';

const { complete } = await import('../src/llm.js');

function captureFetch(payload) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => '',
    };
  };
  return calls;
}

test('local tier posts to the native /api/chat endpoint', async () => {
  const calls = captureFetch({ message: { role: 'assistant', content: 'hola' } });
  const text = await complete('local', [{ role: 'user', content: 'hola' }]);

  assert.equal(text, 'hola');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:8080/api/chat');
  assert.equal(calls[0].body.model, 'qwen2.5:1.5b-instruct-q4_0');
  assert.equal(calls[0].body.stream, false);
});

test('local tier sends the measured thread count and a bounded output', async () => {
  const calls = captureFetch({ message: { content: 'ok' } });
  await complete('local', [{ role: 'user', content: 'hola' }]);

  assert.equal(calls[0].body.options.num_thread, 5);
  assert.equal(calls[0].body.options.num_predict, 120);
  assert.equal(calls[0].body.keep_alive, '24h');
});

test('local tier rejects an empty completion instead of answering with nothing', async () => {
  captureFetch({ message: { content: '   ' } });
  await assert.rejects(() => complete('local', [{ role: 'user', content: 'hola' }]), /empty completion/);
});

test('cloud tier still uses the OpenAI-compatible endpoint', async () => {
  const calls = captureFetch({ choices: [{ message: { content: 'nube' } }] });
  const text = await complete('cloud', [{ role: 'user', content: 'hola' }]);

  assert.equal(text, 'nube');
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[0].headers.authorization, 'Bearer test-key');
  assert.equal(calls[0].body.max_tokens, 400);
});
