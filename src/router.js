// Routing rules: decides whether a message is answered locally or escalated
// to a cloud model. Deterministic on purpose — a 0.5B model cannot reliably
// tell you when it is out of its depth.
//
// This file deliberately knows NOTHING about tools. Clock, arithmetic, memory
// and the body tools describe their own triggers in toolset.js, and pipeline.js
// asks them before falling back here. Duplicating those patterns here is how
// the router audit found six live lies: two copies of "what a clock question
// looks like" drift apart, and the older one keeps answering.
//
// So the only question answered here is: local model, or cloud model?

const CLOUD_RULES = [
  {
    reason: 'realtime',
    // Data that changes and cannot be known from training. Every word here is a
    // word somebody actually said; the holes in this list are lies the robot
    // tells, which is why routing belongs in a tool contract and not in regex.
    re: /\b(clima|noticias?|cotizaci[oó]n|d[oó]lar|pron[oó]stico|partido|llover|llueve|lluvia|temperatura|nevada|sal[ií][oó]|gan[oó]|papa|presidente|elecciones|gobierno|ministr\w+|falleci[oó]|muri[oó]|precio|qui[eé]n es el|cu[aá]ndo (viene|viaja|llega|es el))\b/i,
  },
  {
    reason: 'search',
    // Prefix match so "buscame", "averiguame", "investigalo" all hit.
    re: /\b(busc|averigu|investig|google)/i,
  },
  {
    reason: 'code',
    re: /\b(c[oó]digo|funci[oó]n|script|program[aá]|python|javascript|typescript|sql|regex)\b/i,
  },
];

const LONG_TEXT_CHARS = 280;

/**
 * @param {string|null|undefined} text
 * @returns {{ target: 'cloud'|'local'|'ignore', reason: string }}
 */
export function route(text) {
  const value = typeof text === 'string' ? text.trim() : '';
  if (value.length === 0) {
    return { target: 'ignore', reason: 'empty' };
  }

  for (const rule of CLOUD_RULES) {
    if (rule.re.test(value)) {
      return { target: 'cloud', reason: rule.reason };
    }
  }

  if (value.length > LONG_TEXT_CHARS) {
    return { target: 'cloud', reason: 'long' };
  }

  // Default to cloud for high-IQ reasoning, conversation and world knowledge.
  // The local 1.5B model acts as fallback when offline or cloud is unreachable.
  return { target: 'cloud', reason: 'default' };
}
