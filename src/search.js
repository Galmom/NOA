// Web search provider using DuckDuckGo Lite.
//
// Fast, zero-dependency, no external API keys required.
// Fetches search snippets and formats them as context for the language model.

const SEARCH_TIMEOUT_MS = 3000;

/**
 * Searches DuckDuckGo Lite and returns the top snippets.
 * @param {string} query
 * @param {number} [maxResults=3]
 * @returns {Promise<string[]>}
 */
export async function searchWeb(query, maxResults = 3) {
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return [];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const res = await fetch('https://lite.duckduckgo.com/lite/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: 'q=' + encodeURIComponent(query.trim()),
      signal: controller.signal,
    });

    if (!res.ok) {
      return [];
    }

    const html = await res.text();
    const matches = [...html.matchAll(/class=['"]result-snippet['"]>([\s\S]*?)<\/td>/g)];

    return matches
      .slice(0, maxResults)
      .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
      .filter((s) => s.length > 0);
  } catch (err) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

