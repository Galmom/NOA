import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DEFAULT_PATH = process.env.BRAIN_DB ?? 'data/brain.db';

export function openMemory(path = DEFAULT_PATH) {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS facts (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
  `);

  const insertMessage = db.prepare('INSERT INTO messages (role, content) VALUES (?, ?)');
  const recentMessages = db.prepare(
    'SELECT role, content FROM messages ORDER BY id DESC LIMIT ?',
  );
  const upsertFact = db.prepare(
    `INSERT INTO facts (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  );
  const getFact = db.prepare('SELECT value FROM facts WHERE key = ?');

  return {
    /** Persist one turn and return nothing. */
    add(role, content) {
      insertMessage.run(role, String(content));
    },

    /** Last N turns, oldest first — ready to feed an OpenAI-style payload. */
    recent(limit = 12) {
      return recentMessages.all(limit).reverse();
    },

    setFact(key, value) {
      upsertFact.run(String(key), String(value));
    },

    getFact(key) {
      return getFact.get(String(key))?.value ?? null;
    },

    close() {
      db.close();
    },
  };
}
