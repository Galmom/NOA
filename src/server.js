import { WebSocketServer } from 'ws';
import dgram from 'node:dgram';
import { plan } from './pipeline.js';
import { createTools, createToolset, MAX_DISTANCE_M } from './toolset.js';
import { createBodyLink, describeOutcome } from './body.js';
import { createCameraLink } from './camera.js';
import { complete, cloudConfigured, cloudStatus, cloudIndependence, loadProviders } from './llm.js';
import { openMemory } from './memory.js';
import { buildHistory } from './history.js';
import { startAdmin } from './admin.js';
import { SYSTEM_PROMPT, CLOUD_PROMPT, fallbackReply } from './personality.js';
import { createStt } from './stt.js';
import { searchWeb } from './search.js';
import { extractWakeWord } from './wakeword.js';

const PORT = Number(process.env.BRAIN_PORT ?? 8765);
const ADMIN_PORT = Number(process.env.BRAIN_ADMIN_PORT ?? 8766);
const ADMIN_TOKEN = process.env.BRAIN_ADMIN_TOKEN ?? '';

const groq = loadProviders().find((p) => p.name === 'groq' || p.baseUrl.includes('groq'));
const stt = createStt({
  apiKey: process.env.GROQ_API_KEY || groq?.apiKey || '',
});

const memory = openMemory();
const toolset = createToolset(createTools({ memory }));
const body = createBodyLink({ timeoutMs: Number(process.env.BRAIN_BODY_TIMEOUT_MS ?? 5000) });
const camera = createCameraLink();

/**
 * A rejected physical command is a question back to the owner, not a guess.
 *
 * Defaulting "avanzá" to some distance would be the brain deciding how far a
 * robot moves — a decision it has no business making silently.
 * @param {{tool?: string, reason?: string}} outcome
 */
function invalidToolReply(outcome) {
  if (outcome.tool === 'move') {
    if (outcome.reason === 'too_far') {
      return `No puedo pedir más de ${MAX_DISTANCE_M} metros de una vez.`;
    }
    if (outcome.reason === 'no_direction') {
      return '¿Para dónde? Adelante, atrás, izquierda o derecha.';
    }
    return '¿Cuánto querés que avance? Decime los metros.';
  }

  if (outcome.tool === 'light') {
    return '¿Prendo o apago la luz?';
  }

  return null;
}

function buildMessages(userText, target = 'local', searchContext = '') {
  let prompt = target === 'cloud' ? CLOUD_PROMPT : SYSTEM_PROMPT;
  if (searchContext) {
    prompt += `\nInformación web reciente:\n${searchContext}`;
  }
  return [
    { role: 'system', content: prompt },
    ...buildHistory(memory.recent(24)),
    { role: 'user', content: userText },
  ];
}

async function handleText(userText) {
  const step = plan(userText, { toolset });

  if (step.kind === 'ignore') {
    return { text: '', target: 'ignore', reason: step.reason, expression: 'sleepy' };
  }

  if (step.kind === 'tool') {
    const outcome = await toolset.dispatch(userText, { tool: step.tool });

    if (outcome.status === 'answered') {
      memory.add('user', userText);
      memory.add('assistant', outcome.text);
      return {
        text: outcome.text,
        target: 'tool',
        reason: outcome.tool,
        expression: 'neutral',
        ms: outcome.ms,
      };
    }

    if (outcome.status === 'proposal') {
      memory.add('user', userText);

      // The brain has decided WHAT, never WHETHER. The confirmation comes from
      // the controller, and the sentence comes from the confirmation.
      const result = await body.execute(outcome.proposal);
      const text = describeOutcome(outcome.proposal, result);
      memory.add('assistant', text);

      return {
        text,
        target: 'body',
        reason: result.executed ? 'executed' : (result.reason ?? 'rejected'),
        proposal: outcome.proposal,
        result,
        expression: result.executed ? 'neutral' : 'sad',
        ms: outcome.ms,
      };
    }

    // A tool claimed the sentence and could not finish. The reply is still
    // deterministic for the two cases where a guess would be physically or
    // arithmetically wrong.
    const rejection = invalidToolReply(outcome);
    if (rejection) {
      memory.add('user', userText);
      memory.add('assistant', rejection);
      return {
        text: rejection,
        target: 'tool',
        reason: `${outcome.tool}:${outcome.reason ?? outcome.status}`,
        expression: 'neutral',
      };
    }

    // Otherwise fall through to where the router said this belongs. Math goes to
    // the cloud on purpose: the small model is what invents digits.
    step.kind = outcome.tool === 'math' ? 'cloud' : 'local';
    step.reason = `${outcome.tool}:${outcome.status}`;
  }

  if (step.kind === 'cloud' && !cloudConfigured()) {
    // Keep the robot honest instead of silently answering with the small model.
    memory.add('user', userText);
    return {
      text: 'Eso necesita internet y no estoy configurado para eso todavía.',
      target: 'cloud',
      reason: `${step.reason}:unconfigured`,
      expression: 'sad',
    };
  }

  const target = step.kind === 'cloud' ? 'cloud' : 'local';
  memory.add('user', userText);

  let searchContext = '';
  if (target === 'cloud') {
    try {
      const snippets = await searchWeb(userText, 3);
      if (snippets.length > 0) {
        searchContext = snippets.join('\n');
      }
    } catch (e) {
      // Search failure doesn't block answering
    }
  }

  try {
    const answer = await complete(target, buildMessages(userText, target, searchContext));
    memory.add('assistant', answer);

    return {
      text: answer,
      target,
      reason: step.reason,
      expression: target === 'cloud' ? 'thinking' : 'neutral',
    };
  } catch (error) {
    // A dead model is an operational state, not a crash: the robot answers with
    // a short honest line instead of leaking "fetch failed" to the ESP32.
    console.error(`[brain] ${target} tier failed: ${error.message}`);
    return {
      text: fallbackReply(target),
      target,
      reason: `${step.reason}:unreachable`,
      expression: 'sad',
    };
  }
}

const server = new WebSocketServer({ port: PORT, maxPayload: 4 * 1024 * 1024 });

server.on('connection', (socket, request) => {
  const peer = request.socket.remoteAddress;
  console.log(`[brain] client connected: ${peer}`);

  socket.on('message', async (raw, isBinary) => {
    // If it's a binary frame or non-JSON audio buffer, pass it to STT
    if (isBinary || (Buffer.isBuffer(raw) && raw.length > 0 && raw[0] !== 0x7B)) {
      console.log(`[brain] audio packet received: ${raw.length} bytes`);
      if (!stt.configured) {
        console.warn('[brain] audio received but STT is unconfigured');
        socket.send(JSON.stringify({ type: 'error', message: 'stt unconfigured' }));
        return;
      }

      try {
        const text = await stt.transcribe(raw);
        console.log(`[brain] audio transcribed: "${text}"`);
        if (!text || text.trim().length === 0) return;

        // Wake word check for voice audio: only respond if addressed to N.O.A.
        const { addressed, cleanText } = extractWakeWord(text);
        if (!addressed) {
          console.log(`[brain] ignored ambient audio (not addressed to N.O.A.): "${text}"`);
          return;
        }

        const result = await handleText(cleanText);
        socket.send(JSON.stringify({ type: 'reply', userText: text, ...result }));
      } catch (error) {
        console.error('[brain] stt failed:', error.message);
        socket.send(JSON.stringify({ type: 'error', message: error.message }));
      }
      return;
    }

    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      socket.send(JSON.stringify({ type: 'error', message: 'invalid json' }));
      return;
    }

    // A controller's confirmation, never chat. Checked before the chat types so
    // a body-result can never be parsed as text.
    if (body.handleMessage(message)) return;
    if (camera.handleMessage(message, isBinary, raw)) return;

    if (message?.type === 'hello' && message.role === 'body') {
      body.attach(socket);
      socket.send(JSON.stringify({ type: 'hello-ok', role: 'body' }));
      console.log('[brain] body attached');
      return;
    }

    if (message?.type === 'hello' && message.role === 'camera') {
      camera.attach(socket);
      socket.send(JSON.stringify({ type: 'hello-ok', role: 'camera' }));
      console.log('[brain] camera attached');
      return;
    }

    if (message?.type === 'ping') {
      socket.send(JSON.stringify({ type: 'pong', t: Date.now() }));
      return;
    }

    if (message?.type !== 'text') {
      socket.send(JSON.stringify({ type: 'error', message: `unsupported type: ${message?.type}` }));
      return;
    }

    try {
      const result = await handleText(message.text);
      socket.send(JSON.stringify({ type: 'reply', ...result }));
    } catch (error) {
      console.error('[brain] handler failed:', error.message);
      socket.send(JSON.stringify({ type: 'error', message: error.message }));
    }
  });

  socket.on('close', () => {
    body.detach(socket);
    console.log(`[brain] client disconnected: ${peer}`);
  });
});

console.log(`[brain] listening on ws://0.0.0.0:${PORT}`);
console.log(`[brain] cloud tier: ${cloudConfigured() ? 'configured' : 'not configured'}`);

startAdmin({
  port: ADMIN_PORT,
  token: ADMIN_TOKEN,
  onStatus: () => ({
    ok: true,
    clients: server.clients.size,
    body: body.online,
    cloud: cloudConfigured(),
    providers: cloudStatus(),
    independentProviders: cloudIndependence(),
  }),
  // The owner states who they are; the brain never guesses a name.
  onFact: (key, value) => memory.setFact(key, value),
  onRestart: () => {
    // The supervisor in daemon.sh re-runs node as soon as this process exits,
    // so "restart" is just a clean exit. Close the socket first so a connected
    // ESP32 sees a normal disconnect instead of a half-open connection.
    console.log('[brain] restart requested, exiting for the supervisor');
    server.close();
    process.exit(0);
  },
});

console.log(
  `[brain] admin ${ADMIN_TOKEN ? `on 127.0.0.1:${ADMIN_PORT}` : 'disabled (no BRAIN_ADMIN_TOKEN)'}`,
);

const UDP_PORT = Number(process.env.BRAIN_UDP_PORT ?? 8767);
const udp = dgram.createSocket('udp4');
udp.on('message', (msg, rinfo) => {
  if (msg.toString().trim() === 'walle-discover') {
    const reply = Buffer.from(JSON.stringify({ type: 'brain-here', port: PORT }));
    udp.send(reply, rinfo.port, rinfo.address, () => {
      console.log(`[brain] UDP discovery response sent to ${rinfo.address}:${rinfo.port}`);
    });
  }
});
udp.on('error', (err) => console.warn('[brain] UDP discovery error:', err.message));
udp.bind(UDP_PORT, () => {
  console.log(`[brain] UDP discovery listening on port ${UDP_PORT}`);
});
