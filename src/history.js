// Turns the raw message store into a prompt-sized history window.
//
// Two failure modes come from feeding everything to a 0.5B model:
//  * canned fallbacks get echoed back as if they were real conversation, so the
//    robot starts repeating "no me responde el cerebro local";
//  * a long window dilutes the system prompt, and the model answers by parroting
//    the last thing it read.
//
// So the window keeps only real turns, trims each one, and stops at a character
// budget instead of counting messages alone.

const CANNED_PREFIXES = [
  '[stub:',
  'No me responde el cerebro local',
  'No pude conectarme con la nube',
  'Eso necesita internet',
];

export function isCanned(content) {
  return CANNED_PREFIXES.some((prefix) => content.startsWith(prefix));
}

/**
 * @param {{role: string, content: string}[]} rows oldest first
 * @param {{limit?: number, maxChars?: number, perMessageChars?: number}} [options]
 */
export function buildHistory(rows, options = {}) {
  // Small window on purpose: a sliding window of several turns costs seconds of
  // prompt ingestion per reply on this phone, and it cannot be cached because
  // dropping the oldest turn changes the prefix every time. Two turns are enough
  // for the robot to follow the thread.
  const { limit = 3, maxChars = 220, perMessageChars = 110 } = options;

  const usable = rows
    .filter((row) => (row.role === 'user' || row.role === 'assistant') && typeof row.content === 'string')
    .filter((row) => row.content.trim().length > 0 && !isCanned(row.content))
    .slice(-limit);

  const kept = [];
  let budget = maxChars;

  // Walk backwards so the most recent turns survive the budget, then restore order.
  for (let i = usable.length - 1; i >= 0; i--) {
    const row = usable[i];
    const content = row.content.trim().slice(0, perMessageChars);
    if (content.length > budget) break;
    budget -= content.length;
    kept.unshift({ role: row.role, content });
  }

  return kept;
}
