// One decision, one place.
//
// The order here is the whole architecture:
//
//   1. empty           -> nothing to do
//   2. body tool       -> physical command; a language model NEVER adjudicates it,
//                         not even when the sentence also mentions the weather
//   3. read tool       -> deterministic answer (clock, math, memory)
//   4. cloud / local   -> decided by router (defaults to high-IQ cloud 120B)

import { route } from './router.js';

/**
 * @typedef {{kind: 'ignore'|'cloud'|'local'|'tool', reason: string, tool?: object}} Plan
 */

/**
 * @param {string} text
 * @param {{toolset: {firstBody: Function, match: Function}}} deps
 * @returns {Plan}
 */
export function plan(text, { toolset }) {
  const decision = route(text);

  if (decision.target === 'ignore') {
    return { kind: 'ignore', reason: decision.reason };
  }

  // Physical first. Anything that moves a motor or flips a light has exactly one
  // interpreter, and it is this deterministic one.
  const bodyTool = toolset.firstBody(text);
  if (bodyTool) {
    return { kind: 'tool', reason: bodyTool.name, tool: bodyTool };
  }

  // Read tools (clock, math, memory) beat the language model because arithmetic
  // and exact local time must never be guessed by any model.
  const [claimed] = toolset.match(text);
  if (claimed) {
    return { kind: 'tool', reason: claimed.name, tool: claimed };
  }

  // General conversation, reasoning, code, live data escalates to cloud.
  return { kind: decision.target, reason: decision.reason };
}
