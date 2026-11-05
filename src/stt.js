// Speech-to-text integration using Groq Whisper.
//
// Converts raw 16 kHz 16-bit mono PCM buffers from the ESP32 into standard
// WAV containers and transcribes them in ~200 ms using Groq's whisper-large-v3-turbo.

export function pcmToWav(pcmBuffer, sampleRate = 16000, numChannels = 1, bitsPerSample = 16) {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20);  // AudioFormat (1 for PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

export function createStt({
  apiKey,
  baseUrl = 'https://api.groq.com/openai/v1',
  model = 'whisper-large-v3-turbo',
  fetchImpl,
} = {}) {
  const doFetch = fetchImpl ?? ((...args) => fetch(...args));

  async function transcribe(buffer) {
    if (!apiKey) {
      throw new Error('STT unconfigured: missing API key');
    }

    if (!buffer || buffer.length === 0) {
      return '';
    }

    // Wrap raw PCM in a WAV header if not already a WAV file
    const isWav = buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF';
    const wav = isWav ? buffer : pcmToWav(buffer);

    const formData = new FormData();
    const blob = new Blob([wav], { type: 'audio/wav' });
    formData.append('file', blob, 'audio.wav');
    formData.append('model', model);
    formData.append('language', 'es');
    formData.append('temperature', '0.0');

    const response = await doFetch(`${baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`STT failed with ${response.status}: ${detail.slice(0, 120)}`);
    }

    const payload = await response.json();
    const rawText = (payload?.text ?? '').trim();

    // Filtro de alucinaciones típicas de Whisper ante ruidos secos o golpes
    const normalized = rawText.toLowerCase().replace(/[.,!¡?¿]/g, '').trim();
    const NOISE_ARTIFACTS = new Set([
      'oh', 'gracias', 'thank you', 'you', 'close your eyes', 'bye', 'chau', 'subtítulos', 'subtitulos'
    ]);

    if (NOISE_ARTIFACTS.has(normalized) || normalized.length < 3) {
      return '';
    }

    return rawText;
  }

  return {
    transcribe,
    get configured() {
      return Boolean(apiKey);
    },
  };
}

