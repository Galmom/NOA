// Deterministic answers for facts that must never be invented.
//
// A language model cannot know the time, and asking one is how you get a
// confident, wrong answer. These questions are answered by the device clock
// instead, which costs nothing and is never wrong. Everything here is pure so
// the tests can pin an exact date.

const ASKS_TIME = /\b(qu[eé]|ten[eé]s|me dec[ií]s)?\s*(hora|horario)\b/i;
const ASKS_DATE =
  /\b(qu[eé]\s+(?:d[ií]a|fecha)(?:\s+(?:es|tenemos|hoy))?\??$|qu[eé]\s+(?:d[ií]a|fecha)\s+(?:es|tenemos|hoy)\b|fecha\s+de\s+hoy|d[ií]a\s+de\s+hoy|estamos\s+a\b|y\s+la\s+fecha\b|la\s+fecha\s*(\?|$))/i;

const TIME_ZONE = process.env.BRAIN_TZ ?? undefined;

// "¿Qué hora te parece mejor para dormir?" is a conversation, not a clock
// lookup. Answering it with the actual time would be technically correct and
// completely wrong, so anything asking for judgement is left to the model.
const ASKS_ADVICE = /\b(mejor|conviene|recomend\w*|prefer\w*|parece|crees|opinas?)\b/i;

// The device knows exactly one timezone. Asked "que hora es en Tokio" it used to
// answer Buenos Aires' time with total confidence — the same lie this tool exists
// to prevent. Escalating would not fix it either: a cloud model has no clock, so
// it would invent one. The honest answer is what the device actually knows.
const FOREIGN_PLACE =
  /\b(?:hora|horario)\b[\s\S]*?\b(?:en|de)\s+((?!la\b|el\b|las\b|los\b|tu\b|mi\b|su\b)[a-záéíóúñ]{3,})\b/i;

// Places that share this device's timezone, so naming them is not "foreign".
const SAME_ZONE = /^(?:argentina|aca|acá|casa|buenos|aires|caba|mañana|tarde|noche)$/i;

export const FOREIGN_TIME_ANSWER = 'Solo sé la hora de acá.';

function timeFormatter() {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: TIME_ZONE,
  });
}

function dateFormatter() {
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: TIME_ZONE,
  });
}

export function formatTime(now) {
  return timeFormatter().format(now);
}

export function formatDate(now) {
  // es-AR emits "domingo, 2 de noviembre de 2026"; the comma reads awkwardly in
  // a spoken sentence.
  return dateFormatter().format(now).replace(',', '');
}

/**
 * Answers a clock question without a model, or returns null when the text is
 * not asking for one.
 * @param {string} text
 * @param {Date} [now]
 * @returns {string|null}
 */
export function answerClock(text, now = new Date()) {
  const value = typeof text === 'string' ? text : '';
  if (value.trim().length === 0) return null;
  if (ASKS_ADVICE.test(value)) return null;

  const place = value.match(FOREIGN_PLACE)?.[1];
  if (place && !SAME_ZONE.test(place)) return FOREIGN_TIME_ANSWER;

  const wantsDate = ASKS_DATE.test(value);
  const wantsTime = ASKS_TIME.test(value);

  if (wantsDate && wantsTime) {
    return `Son las ${formatTime(now)}, del ${formatDate(now)}.`;
  }
  if (wantsDate) {
    return `Hoy es ${formatDate(now)}.`;
  }
  if (wantsTime) {
    return `Son las ${formatTime(now)}.`;
  }
  return null;
}

// --- Arithmetic -------------------------------------------------------------
//
// Why this exists: asked "cuanto es 847 por 2391?", the local 1.5B answered
// "203.564,77" with no hesitation. The real answer is 2.025.177. Arithmetic is
// not a language task, and a wrong number delivered confidently is worse than
// "no sé". The cloud is not the answer either: it costs a second, spends quota,
// and can still slip. A calculator is instant and exact.

// Filler people put before an operation. Stripped only at the start, so
// "cuanto es el dolar" is never turned into an arithmetic attempt.
const MATH_PREFIX =
  /^(?:(?:che|dale|hey|wal-?e)[,\s]+)*(?:cu[aá]nto\s+(?:es|da|son|vale|ser[ií]a)|calcula(?:me|lo)?|resolv[eé](?:me)?|cu[aá]l\s+es\s+el\s+resultado\s+de)\s+/i;

// Longest first: "dividido por" must become "/" before "por" becomes "*".
const WORD_OPERATORS = [
  [/\bdividido\s+(?:por|entre)\b/g, '/'],
  [/\bentre\b/g, '/'],
  [/\bdividido\b/g, '/'],
  [/\bpor\b/g, '*'],
  [/\bm[aá]s\b/g, '+'],
  [/\bmenos\b/g, '-'],
  [/[x×]/gi, '*'],
  [/÷/g, '/'],
];

// A number is digits with an optional comma decimal. A dot is deliberately NOT
// accepted: in es-AR it is the thousands separator, so "3.5" is ambiguous
// between three and a half and thirty-five hundred. Guessing there would be the
// same lie in a smaller size.
const NUMBER = String.raw`\d+(?:,\d+)?`;
const PURE_EXPRESSION = new RegExp(`^-?${NUMBER}(?:\\s*[+\\-*/]\\s*-?${NUMBER})+$`);

const NUMBER_FORMAT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 10 });

const PRECEDENCE = { '+': 1, '-': 1, '*': 2, '/': 2 };

function toPostfix(tokens) {
  const output = [];
  const operators = [];

  for (const token of tokens) {
    if (typeof token === 'number') {
      output.push(token);
      continue;
    }

    const top = operators.at(-1);
    if (top && PRECEDENCE[top] >= PRECEDENCE[token]) {
      output.push(operators.pop());
    }
    operators.push(token);
  }

  while (operators.length > 0) output.push(operators.pop());
  return output;
}

function evaluatePostfix(postfix) {
  const stack = [];

  for (const token of postfix) {
    if (typeof token === 'number') {
      stack.push(token);
      continue;
    }

    const right = stack.pop();
    const left = stack.pop();
    if (left === undefined || right === undefined) return Number.NaN;

    if (token === '+') stack.push(left + right);
    else if (token === '-') stack.push(left - right);
    else if (token === '*') stack.push(left * right);
    else stack.push(left / right);
  }

  return stack.length === 1 ? stack[0] : Number.NaN;
}

const PERCENTAGE = new RegExp(
  `^(?:el\\s+)?(${NUMBER})\\s*(?:%|por\\s+ciento)\\s+de\\s+(${NUMBER})$`,
  'i',
);

/**
 * Turns text into something evaluable, or null when it is not arithmetic.
 *
 * Split from the evaluation so a tool can validate its parameters before
 * running anything — the difference between "this is not a sum" and "this sum
 * failed".
 * @param {string} text
 * @returns {{kind: 'percent', part: number, whole: number}|{kind: 'expression', postfix: (number|string)[]}|null}
 */
export function parseMath(text) {
  let value = typeof text === 'string' ? text.trim() : '';
  if (value.length === 0) return null;

  value = value.replace(MATH_PREFIX, '');
  value = value.replace(/[?¿¡!]/g, '').trim();

  // Percentages read as a question, not a formula: "el 10% de 500".
  const percent = value.match(PERCENTAGE);
  if (percent) {
    return {
      kind: 'percent',
      part: Number(percent[1].replace(',', '.')),
      whole: Number(percent[2].replace(',', '.')),
    };
  }

  for (const [pattern, symbol] of WORD_OPERATORS) {
    value = value.replace(pattern, symbol);
  }
  value = value.replace(/\s+/g, ' ').trim();

  if (!PURE_EXPRESSION.test(value)) return null;

  const tokens = [];
  const pattern = /(-?\d+(?:,\d+)?)|([+\-*/])/g;
  let match;
  while ((match = pattern.exec(value)) !== null) {
    tokens.push(match[1] !== undefined ? Number(match[1].replace(',', '.')) : match[2]);
  }

  return { kind: 'expression', postfix: toPostfix(tokens) };
}

/**
 * Answers exact arithmetic without a model, or returns null when the text is
 * not a pure expression.
 *
 * Deliberately strict: the whole normalized string must be an expression. A
 * partial parse ("2 mas 3 personas") returns null and lets the router escalate
 * instead of answering a question nobody asked.
 * @param {string} text
 * @returns {string|null}
 */
export function answerMath(text) {
  const parsed = parseMath(text);
  if (!parsed) return null;

  const result =
    parsed.kind === 'percent'
      ? (parsed.part / 100) * parsed.whole
      : evaluatePostfix(parsed.postfix);

  if (!Number.isFinite(result)) return 'No se puede dividir por cero.';

  // -0 formats as "-0" and reads like an error out loud.
  return `Son ${NUMBER_FORMAT.format(result === 0 ? 0 : result)}.`;
}
