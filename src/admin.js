// Tiny admin surface for a headless device.
//
// The phone's screen and digitizer are broken, so every deploy used to end with
// someone opening Termux and typing `bash daemon.sh` by hand. With the supervisor
// loop in daemon.sh, the process only has to exit: this endpoint asks it to.
// Bound to loopback and gated by a shared token, because "restart the process"
// should not be reachable by anything else on the network.
import { createServer } from 'node:http';

/** Facts the brain is allowed to read back. Anything else is noise in the DB. */
const WRITABLE_FACTS = new Set(['owner_name', 'owner_notes']);

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      // A fact is a name, not a document. Refuse to buffer an upload.
      if (raw.length > 4096) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

export function startAdmin({ port = 8766, token, onRestart, onStatus, onFact }) {
  const server = createServer(async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method !== 'POST') {
      reply(405, { error: 'use POST' });
      return;
    }

    if (!token || req.headers['x-brain-token'] !== token) {
      reply(401, { error: 'unauthorized' });
      return;
    }

    if (req.url === '/restart') {
      // Answer before dying, otherwise the client sees a reset instead of a
      // clean acknowledgement and cannot tell success from a crash.
      reply(202, { ok: true, action: 'restarting' });
      setTimeout(onRestart, 150);
      return;
    }

    if (req.url === '/status') {
      reply(200, onStatus());
      return;
    }

    if (req.url === '/logs') {
      import('node:fs').then((fs) => {
        try {
          const logContent = fs.readFileSync('brain.log', 'utf8');
          const lines = logContent.split('\n');
          reply(200, { ok: true, lines: lines.slice(-40) });
        } catch (e) {
          reply(500, { ok: false, error: e.message });
        }
      });
      return;
    }

    if (req.url === '/fact') {
      const payload = await readJson(req);

      if (!payload || typeof payload.key !== 'string' || typeof payload.value !== 'string') {
        reply(400, { error: 'expected {key, value}' });
        return;
      }

      if (!WRITABLE_FACTS.has(payload.key)) {
        reply(400, { error: `unknown fact: ${payload.key}`, allowed: [...WRITABLE_FACTS] });
        return;
      }

      // The owner states who they are; the brain never guesses a name.
      onFact?.(payload.key, payload.value);
      reply(200, { ok: true, key: payload.key });
      return;
    }

    reply(404, { error: 'unknown route' });
  });

  server.listen(port, '127.0.0.1');
  return server;
}
