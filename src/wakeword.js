// Wake word detector and query extractor for N.O.A. (Núcleo Operativo Autónomo).

const WAKE_WORD_REGEX = /^[¡¿\s]*(?:(?:che|ey|hola|ok|oye)\b[,:;.\s]*)?(?:n[\s.]*o[\s.]*a|noah|noha|nova|noe|noé)\b[,:;.!?\s]*/i;

/**
 * Checks if the text addresses N.O.A. and returns the clean command.
 * The wake word must be at the beginning, optionally preceded by a greeting.
 * @param {string} text
 * @returns {{ addressed: boolean, cleanText: string }}
 */
export function extractWakeWord(text) {
  if (!text || typeof text !== 'string') {
    return { addressed: false, cleanText: '' };
  }

  const trimmed = text.trim();
  const match = trimmed.match(WAKE_WORD_REGEX);

  if (!match) {
    return { addressed: false, cleanText: trimmed };
  }

  const clean = trimmed.slice(match[0].length).replace(/^[.,:;!?\s]+/, '').trim();

  return {
    addressed: true,
    cleanText: clean.length > 0 ? clean : 'hola',
  };
}
