// Wake word detector and query extractor for N.O.A. (Núcleo Operativo Autónomo).
//
// Matches variations of "NOA", "N.O.A.", "Noah", "Nova", "Noé", "A que" / "A qué"
// (common Whisper mis-transcriptions for "Noa qué...").

const WAKE_WORD_REGEX = /^[¡¿\s]*(?:(?:che|ey|hola|ok|oye)\b[,:;.\s]*)?(?:n[\s.]*o[\s.]*a|noah|noha|nova|noe|noé|a\s*qu[eé])\b[,:;.\s!?]*/i;

/**
 * Checks if the text addresses N.O.A. and returns the clean command.
 * @param {string} text
 * @returns {{ addressed: boolean, cleanText: string }}
 */
export function extractWakeWord(text) {
  if (!text || typeof text !== 'string') {
    return { addressed: false, cleanText: '' };
  }

  const trimmed = text.trim();
  const match = trimmed.match(WAKE_WORD_REGEX);

  if (match) {
    let clean = trimmed.slice(match[0].length).replace(/^[.,:;!?\s]+/, '').trim();
    // Si fue "a que hora es", reconstruir a "que hora es"
    if (trimmed.toLowerCase().startsWith('a que') || trimmed.toLowerCase().startsWith('a qué')) {
      clean = trimmed.slice(2).trim();
    }
    return {
      addressed: true,
      cleanText: clean.length > 0 ? clean : 'hola',
    };
  }

  // Also check if "Noa" or variants are in the first 3 words
  const words = trimmed.toLowerCase().replace(/[¡¿!?,.:;]/g, '').split(/\s+/).slice(0, 3);
  if (words.some((w) => ['noa', 'noah', 'noha', 'nova'].includes(w))) {
    const clean = trimmed.replace(/^[¡¿\s]*(?:hola|che|ey|oye|ok)?\s*(?:noa|noah|noha|nova)[,.:;!?\s]*/i, '').trim();
    return {
      addressed: true,
      cleanText: clean.length > 0 ? clean : 'hola',
    };
  }

  return { addressed: false, cleanText: trimmed };
}
