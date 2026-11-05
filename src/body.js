// The only path from a decision to a physical action.
//
// The rule this file exists to enforce: the brain PROPOSES, the body EXECUTES
// and REPORTS. A proposal that returns `executed: true` is not a movement — it
// is a request. Only a `body-result` frame from the ESP32 is evidence that
// something moved, and it is the only thing that can become a sentence the user
// hears.
//
// Why the two-step shape matters: the ESP32 applies its own physical envelope
// (speed limits, obstacle stop, comms loss) and reports the real outcome. Asked
// for 2 metres it may answer "0.35 m, obstacle_detected". The brain must say
// 35 cm. Reporting the 2 m it asked for would be the same confident lie as a
// miscalculated sum, only with wheels.
//
// No body connected is not an error to hide: it is a state to report. Saying
// "listo" when nothing is plugged in is the worst possible answer.

/** Reasons the brain adds itself, never invented by the body. */
export const BODY_OFFLINE = 'offline';
export const BODY_TIMEOUT = 'timeout';

/** Controller reasons translated for a human, never surfaced as raw codes. */
const REASON_TEXT = {
  [BODY_OFFLINE]: 'no tengo cuerpo conectado',
  [BODY_TIMEOUT]: 'el cuerpo no me contestó',
  obstacle_detected: 'hay un obstáculo',
  comm_lost: 'perdí comunicación con el cuerpo',
  sensor_fault: 'falló un sensor',
  out_of_range: 'está fuera de los límites',
  invalid_command: 'el comando no era válido',
};

function centimetres(metres) {
  return Math.round(metres * 100);
}

/**
 * Turns a proposal and the body's confirmation into the one sentence the user
 * hears.
 *
 * The proposal is never mentioned. If the brain asked for 2 m and the body
 * reports 0.35 m, this says 35 cm — the requested number is not evidence and
 * repeating it would be a lie with a receipt.
 * @param {{action: string, direction?: string, distance_m?: number, state?: string}} proposal
 * @param {{accepted: boolean, executed: boolean, reason: string|null, distance_m: number|null, state: string|null}} result
 */
export function describeOutcome(proposal, result) {
  if (!result.accepted) {
    const why = REASON_TEXT[result.reason] ?? 'el cuerpo no lo aceptó';
    return `No lo hice: ${why}.`;
  }

  if (!result.executed) {
    const why = REASON_TEXT[result.reason] ?? 'no llegó a ejecutarlo';
    return `No lo hice: ${why}.`;
  }

  if (proposal.action === 'light') {
    if (result.state === 'on') return 'La luz quedó prendida.';
    if (result.state === 'off') return 'La luz quedó apagada.';
    return 'El cuerpo dice que lo hizo, pero no me confirmó el estado de la luz.';
  }

  if (proposal.action === 'move') {
    if (proposal.direction === 'left') return 'Giré a la izquierda.';
    if (proposal.direction === 'right') return 'Giré a la derecha.';

    const verb = proposal.direction === 'backward' ? 'Retrocedí' : 'Avancé';

    // The distance is optional evidence: a controller may confirm the movement
    // without measuring it, and inventing a number to fill the sentence is the
    // exact failure this module exists to prevent.
    if (result.distance_m === null) {
      return `El cuerpo dice que se movió, pero no me confirmó cuánto.`;
    }

    return `${verb} ${centimetres(result.distance_m)} cm.`;
  }

  return 'El cuerpo confirmó que lo hizo.';
}

/**
 * Keep only fields the brain understands, with their types checked.
 *
 * A controller on the other end of a socket is an untrusted input like any
 * other. Accepting `distance_m: "2"` or `executed: "yes"` would put a string
 * where the reply logic expects a number and turn a confirmation into a lie of
 * a different shape.
 * @param {unknown} raw
 */
function normalizeResult(raw) {
  const accepted = raw?.accepted === true;
  const executed = raw?.executed === true && accepted;

  const distance =
    typeof raw?.distance_m === 'number' && Number.isFinite(raw.distance_m) && raw.distance_m >= 0
      ? raw.distance_m
      : null;

  const state = raw?.state === 'on' || raw?.state === 'off' ? raw.state : null;

  return {
    accepted,
    executed,
    reason: typeof raw?.reason === 'string' && raw.reason.length > 0 ? raw.reason : null,
    distance_m: distance,
    state,
  };
}

/**
 * @param {{timeoutMs?: number}} [options]
 */
export function createBodyLink(options = {}) {
  const timeoutMs = options.timeoutMs ?? 5000;

  /** @type {import('ws').WebSocket|null} At most one body: two would make the
   * confirmation ambiguous, and an ambiguous safety channel is not a channel. */
  let socket = null;

  /** @type {Map<number, {resolve: Function, timer: ReturnType<typeof setTimeout>}>} */
  const pending = new Map();
  let nextId = 1;

  const settle = (id, result) => {
    const waiter = pending.get(id);
    if (!waiter) return false;
    pending.delete(id);
    clearTimeout(waiter.timer);
    waiter.resolve(result);
    return true;
  };

  return {
    /**
     * Register the controller. A second body replaces the first: the last one to
     * say hello is the one whose confirmation the user is waiting for.
     */
    attach(ws) {
      socket = ws;
    },

    detach(ws) {
      if (socket !== ws) return;
      socket = null;
      // Every in-flight request can no longer be confirmed. Failing them now is
      // more honest than waiting for a timeout that is already certain.
      for (const id of [...pending.keys()]) {
        settle(id, {
          accepted: false,
          executed: false,
          reason: BODY_OFFLINE,
          distance_m: null,
          state: null,
        });
      }
    },

    get online() {
      return socket !== null && socket.readyState === 1;
    },

    /**
     * Handles a frame from the body. Returns true when the frame was a result,
     * so the caller knows not to treat it as chat.
     * @param {any} message
     */
    handleMessage(message) {
      if (message?.type !== 'body-result') return false;
      if (!Number.isInteger(message.id)) return true;

      settle(message.id, normalizeResult(message));
      return true;
    },

    /**
     * Ask the body to do one thing and wait for what actually happened.
     *
     * Always resolves. A missing body, a dead socket and a silent controller are
     * all reported as failures — never as success, and never as a thrown error
     * the caller might forget to catch.
     * @param {object} proposal
     */
    execute(proposal) {
      if (!this.online) {
        return Promise.resolve({
          accepted: false,
          executed: false,
          reason: BODY_OFFLINE,
          distance_m: null,
          state: null,
        });
      }

      const id = nextId++;
      const message = JSON.stringify({ type: 'body-command', id, command: proposal });

      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          settle(id, {
            accepted: false,
            executed: false,
            reason: BODY_TIMEOUT,
            distance_m: null,
            state: null,
          });
        }, timeoutMs);

        pending.set(id, { resolve, timer });

        try {
          socket.send(message);
        } catch {
          settle(id, {
            accepted: false,
            executed: false,
            reason: BODY_OFFLINE,
            distance_m: null,
            state: null,
          });
        }
      });
    },
  };
}
