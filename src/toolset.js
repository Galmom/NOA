// The tool contract, and every tool that exists so far.
//
// Why a contract and not a regex table: routing IS the brain. A wrong route is
// a confident wrong answer, and a plain list of regexes has no place to say
// "this one moves a motor, so it cannot just answer".
//
// Shape:
//   name      stable id, also what /status reports
//   risk      'read' -> answers a question
//             'body' -> changes the physical world; never answers by itself
//   asks      RegExp describing the phrasings this tool claims
//   validate  (text) -> {ok:true, value?} | {ok:false, reason}
//   run       (text, value) -> string | null        for read tools
//             (text, value) -> proposal object      for body tools
//   timeout   ms before the tool is abandoned; a hung tool must not hold the
//             conversation open (measured: a saturated provider held 45s)
//
// Measured, on this phone, with qwen2.5:1.5b and three tool schemas: the model
// picked the right tool 4 of 5 times, but "que hora es" took 3.5s instead of
// 0.1s and a knowledge question took 20.4s. So the model is NOT the router. The
// router matches deterministically; the model is the semantic fallback for what
// the router could not claim. It never chooses a 'body' tool: no tool schema is
// ever shown to it.

import { answerClock, answerMath, parseMath } from './tools.js';

const DEFAULT_TIMEOUT_MS = 2000;

/** Sentinel for "the tool did not answer in time". */
const TIMED_OUT = Symbol('timed-out');

const RISKS = new Set(['read', 'body']);

export const clockTool = {
  name: 'clock',
  risk: 'read',
  asks: /\b(hora|horario)\b|\b(qu[eé]\s+(d[ií]a|fecha)|fecha de hoy|d[ií]a de hoy|la fecha)\b/i,
  timeout: 200,
  validate: () => ({ ok: true }),
  run: (text) => answerClock(text),
};

export const mathTool = {
  name: 'math',
  risk: 'read',
  // The loose pattern decides the candidate; validate decides whether this is
  // really arithmetic. Declining here escalates rather than guessing.
  asks: /\d+\s*(?:[+\-*/x×÷%]|por\b|m[aá]s\b|mas\b|menos\b|entre\b|dividido\b)\s*\d+|\d+\s*%/i,
  timeout: 200,
  validate: (text) =>
    parseMath(text)
      ? { ok: true }
      : { ok: false, reason: 'not_an_expression' },
  run: (text) => answerMath(text),
};

/**
 * The one tool whose answer lives in this device and nowhere else.
 *
 * "¿Quién soy?" used to reach the 1.5B, which has no memory of anyone and would
 * invent a name or answer generically. Facts are stored in SQLite and set
 * through the admin endpoint, because the only trustworthy source for the
 * owner's name is the owner.
 * @param {{getFact: (key: string) => string|null}} memory
 */
export function createMemoryTool(memory) {
  return {
    name: 'memory',
    risk: 'read',
    asks: /\b(qui[eé]n soy|mi nombre|c[oó]mo me llamo|me llamo|qu[eé] sab[eé]s de m[ií])\b/i,
    timeout: 200,
    validate: () => ({ ok: true }),
    run: () => {
      const name = memory.getFact('owner_name');
      const notes = memory.getFact('owner_notes');

      if (!name) return 'Todavía no sé tu nombre.';
      return notes ? `Te llamás ${name}. ${notes}` : `Te llamás ${name}.`;
    },
  };
}

// --- Body tools -------------------------------------------------------------
//
// These never execute. They return a proposal, the server forwards it, and the
// ESP32 answers with what actually happened (see body.js).

const NUMBER_WORDS = {
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  medio: 0.5,
  media: 0.5,
};

/** The brain refuses to ask for more than this in one command. */
export const MAX_DISTANCE_M = 5;

const DISTANCE =
  /(\d+(?:[.,]\d+)?)\s*(cm|cent[ií]metros?|m|metros?)\b|\b(un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|medio|media)\s+(cm|cent[ií]metros?|m|metros?)\b/i;

const FORWARD = /\b(avanz\w*|adelante|avanza|segu[ií]|camin[aá])\b/i;
const BACKWARD = /\b(retroced\w*|atr[aá]s|volv[eé]|reversa)\b/i;
const RIGHT = /\b(derecha)\b/i;
const LEFT = /\b(izquierda)\b/i;

/**
 * Reads a distance in metres, or null when the sentence has no distance.
 *
 * "avanzá" with no number is NOT interpreted as a polite default: guessing how
 * far a robot should move is exactly the class of decision the brain must not
 * make silently. The tool rejects it and the reply asks.
 */
function parseDistance(text) {
  const match = String(text).match(DISTANCE);
  if (!match) return null;

  const raw = match[1] ?? match[3];
  const unit = (match[2] ?? match[4] ?? '').toLowerCase();

  const amount = raw in NUMBER_WORDS ? NUMBER_WORDS[raw] : Number(raw.replace(',', '.'));
  if (!Number.isFinite(amount)) return null;

  const isCentimetres = unit.startsWith('cm') || unit.startsWith('cent');
  return isCentimetres ? amount / 100 : amount;
}

export const moveTool = {
  name: 'move',
  risk: 'body',
  asks: /\b(avanz\w*|adelante|retroced\w*|atr[aá]s|movete|mu[eé]vete|gir[aá]|derecha|izquierda)\b/i,
  timeout: 200,
  validate: (text) => {
    const distance = parseDistance(text);

    if (distance === null) return { ok: false, reason: 'no_distance' };
    if (distance <= 0) return { ok: false, reason: 'no_distance' };
    if (distance > MAX_DISTANCE_M) return { ok: false, reason: 'too_far' };

    let direction = 'forward';
    if (BACKWARD.test(text)) direction = 'backward';
    else if (LEFT.test(text)) direction = 'left';
    else if (RIGHT.test(text)) direction = 'right';
    else if (!FORWARD.test(text)) return { ok: false, reason: 'no_direction' };

    return { ok: true, value: { action: 'move', direction, distance_m: distance } };
  },
  run: (text, value) => value,
};

const LIGHT_ON = /\b(prend\w*|encend\w*|prender)\b/i;
const LIGHT_OFF = /\b(apag\w*)\b/i;

export const lightTool = {
  name: 'light',
  risk: 'body',
  asks: /\b(luz|lampara|l[aá]mpara|led)\b/i,
  timeout: 200,
  validate: (text) => {
    const on = LIGHT_ON.test(text);
    const off = LIGHT_OFF.test(text);

    // "prendé y apagá la luz" is not a state; refusing beats picking one.
    if (on === off) return { ok: false, reason: 'no_state' };

    return { ok: true, value: { action: 'light', state: on ? 'on' : 'off' } };
  },
  run: (text, value) => value,
};

export const DEFAULT_TOOLS = [clockTool, mathTool];

/**
 * The tools this brain actually runs, in match order.
 *
 * `memory` is the only tool that needs device state, so the set is built per
 * process instead of hardcoded at module load — that keeps every tool pure
 * enough to test with a fake.
 * @param {{memory: {getFact: (key: string) => string|null}}} deps
 */
export function createTools({ memory }) {
  return [clockTool, mathTool, createMemoryTool(memory), moveTool, lightTool];
}

function assertValidTool(tool) {
  if (!tool || typeof tool.name !== 'string' || tool.name.length === 0) {
    throw new Error('tool needs a name');
  }
  if (!RISKS.has(tool.risk)) {
    throw new Error(`tool ${tool.name}: risk must be "read" or "body"`);
  }
  if (!(tool.asks instanceof RegExp)) {
    throw new Error(`tool ${tool.name}: asks must be a RegExp`);
  }
  if (typeof tool.run !== 'function') {
    throw new Error(`tool ${tool.name}: run must be a function`);
  }
  if (tool.validate !== undefined && typeof tool.validate !== 'function') {
    throw new Error(`tool ${tool.name}: validate must be a function`);
  }
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  // A rejection that arrives after the timeout already won the race must not
  // surface as an unhandled rejection: nobody is listening anymore.
  promise.catch(() => {});
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @param {Array<{name: string, risk: 'read'|'body', asks: RegExp, validate?: Function, run: Function, timeout?: number}>} tools
 */
export function createToolset(tools) {
  tools.forEach(assertValidTool);

  return {
    tools,

    /** Tools claiming this text, in registration order. */
    match(text) {
      const value = typeof text === 'string' ? text : '';
      return tools.filter((tool) => {
        tool.asks.lastIndex = 0;
        return tool.asks.test(value);
      });
    },

    /**
     * The first body tool claiming this text, or null.
     *
     * Checked before any cloud rule so a sentence like "prendé la luz y decime
     * el clima" can never be answered as pure conversation by a language model.
     * A physical command has exactly one interpreter: this one.
     */
    firstBody(text) {
      return this.match(text).find((tool) => tool.risk === 'body') ?? null;
    },

    /**
     * Runs the first tool that claims the text, or the exact tool named in
     * `options.tool`.
     *
     * The explicit form exists so the pipeline can force the body tool it
     * selected: match order is about readability, but a physical command must
     * not lose to a clock question that happens to share the sentence.
     *
     * Status is one of:
     *   'none'      nothing claimed it; the caller decides where it goes
     *   'invalid'   a tool claimed it but rejected the parameters
     *   'answered'  a read tool answered
     *   'declined'  a read tool claimed it and then said it could not answer
     *   'proposal'  a body tool wants to act; nothing has happened yet
     *   'timeout'   the tool was abandoned
     */
    async dispatch(text, options = {}) {
      const tool = options.tool ?? this.match(text)[0];
      if (!tool) return { status: 'none' };

      const started = performance.now();
      const elapsed = () => Math.round(performance.now() - started);

      let check = { ok: true };
      if (tool.validate) {
        check = tool.validate(text) ?? { ok: false, reason: 'invalid' };
        if (!check.ok) {
          return {
            status: 'invalid',
            tool: tool.name,
            risk: tool.risk,
            reason: check.reason ?? 'invalid',
            ms: elapsed(),
          };
        }
      }

      let output;
      try {
        output = await withTimeout(
          Promise.resolve(tool.run(text, check.value)),
          tool.timeout ?? DEFAULT_TIMEOUT_MS,
        );
      } catch (error) {
        return {
          status: 'failed',
          tool: tool.name,
          risk: tool.risk,
          reason: error.message,
          ms: elapsed(),
        };
      }

      if (output === TIMED_OUT) {
        return { status: 'timeout', tool: tool.name, risk: tool.risk, ms: elapsed() };
      }

      // A body tool's return value is a proposal, never an answer. Turning it
      // into a statement of fact is the ESP32's job, because only the ESP32
      // knows what actually moved.
      if (tool.risk === 'body') {
        return {
          status: 'proposal',
          tool: tool.name,
          proposal: output,
          ms: elapsed(),
        };
      }

      if (typeof output !== 'string' || output.trim().length === 0) {
        return { status: 'declined', tool: tool.name, risk: tool.risk, ms: elapsed() };
      }

      return {
        status: 'answered',
        tool: tool.name,
        risk: tool.risk,
        text: output.trim(),
        ms: elapsed(),
      };
    },
  };
}
