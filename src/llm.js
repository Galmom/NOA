// Two tiers, two wire formats.
//
// The local tier talks to Ollama's native /api/chat because the OpenAI-compatible
// /v1 surface does not expose `num_thread`. On the A03's SoC that option is the
// difference between 0.78 tok/s and 6.5 tok/s: Ollama defaults to one thread per
// core, and oversubscribing this chip collapses throughput entirely. Measured
// optimum is 5 threads for the 1.5B model, 6 for the 0.5B.
//
// The cloud tier rotates through a pool of free providers (see providers.js), so
// one exhausted quota does not leave the robot without a "superior".

import { existsSync, readFileSync } from 'node:fs';

import { createCloudClient } from './cloud.js';
import { parseProviders } from './providers.js';

const LOCAL_URL = process.env.LLM_LOCAL_URL ?? 'http://127.0.0.1:8080';
const LOCAL_MODEL = process.env.LLM_LOCAL_MODEL ?? 'qwen2.5:1.5b-instruct-q4_0';
const LOCAL_THREADS = Number(process.env.LLM_LOCAL_THREADS ?? 5);

const PROVIDERS_FILE = process.env.BRAIN_PROVIDERS_FILE ?? 'providers.txt';

const STUB = process.env.BRAIN_STUB === '1';

export function loadProviders() {
  const providers = [];

  if (existsSync(PROVIDERS_FILE)) {
    providers.push(...parseProviders(readFileSync(PROVIDERS_FILE, 'utf8')));
  }

  // A single provider can still be configured the old way, through the
  // environment, which is what the tests and a quick manual run use.
  const key = process.env.LLM_CLOUD_API_KEY ?? '';
  if (key) {
    providers.push({
      name: 'env',
      baseUrl: (process.env.LLM_CLOUD_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, ''),
      model: process.env.LLM_CLOUD_MODEL ?? 'gpt-4o-mini',
      apiKey: key,
    });
  }

  return providers;
}

const cloud = createCloudClient({ providers: loadProviders() });

export function cloudConfigured() {
  return cloud.configured;
}

export function cloudStatus() {
  return cloud.status();
}

/** Independent quotas behind the provider list, not the number of lines. */
export function cloudIndependence() {
  return cloud.independent;
}

async function postJson(url, body, timeoutMs, headers = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function extractLocalText(payload) {
  // Ollama native replies under `message`.
  const text = payload?.message?.content;
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('model returned an empty completion');
  }
  return text.trim();
}

async function completeLocal(messages) {
  const url = `${LOCAL_URL}/api/chat`;

  const response = await postJson(
    url,
    {
      model: LOCAL_MODEL,
      messages,
      stream: false,
      // Keep the weights resident. The first load costs ~12s on this phone;
      // paying it on every idle gap would make the robot feel broken.
      keep_alive: '24h',
      options: {
        num_thread: LOCAL_THREADS,
        num_predict: 120,
        temperature: 0.7,
      },
    },
    // 120 tokens at the measured ~6.5 tok/s needs ~20s; leave room for a cold start.
    45000,
  ).catch((error) => {
    throw new Error(`local model unreachable at ${url}: ${error.message}`);
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`local model returned ${response.status}: ${detail.slice(0, 200)}`);
  }

  return extractLocalText(await response.json());
}

/**
 * @param {'local'|'cloud'} target
 * @param {{role: string, content: string}[]} messages
 * @returns {Promise<string>}
 */
export async function complete(target, messages) {
  if (STUB) {
    const last = messages.at(-1)?.content ?? '';
    return `[stub:${target}] ${last.slice(0, 80)}`;
  }

  if (target === 'cloud') {
    const { text } = await cloud.complete(messages);
    return text;
  }

  return completeLocal(messages);
}
