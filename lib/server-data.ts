import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';

let schemaReady: Promise<void> | null = null;

export function ensureDatabase() {
  schemaReady ??= initializeDatabase();
  return schemaReady;
}

async function initializeDatabase() {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, filename TEXT NOT NULL,
      object_key TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL,
      status TEXT NOT NULL, uploaded_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS document_chunks (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, position INTEGER NOT NULL,
      content TEXT NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, question TEXT NOT NULL,
      answer TEXT NOT NULL, source_document_ids TEXT NOT NULL, created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_documents_user_uploaded ON documents(user_id, uploaded_at DESC)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_chunks_document_position ON document_chunks(document_id, position)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_chats_user_created ON chats(user_id, created_at DESC)'),
  ]);
  await env.DB.prepare('PRAGMA optimize').run();
}

export async function requireApiUser() {
  const user = await getChatGPTUser();
  if (!user) return null;
  await ensureDatabase();
  await env.DB.prepare(`INSERT INTO users (id, email, name, created_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name`)
    .bind(user.userId, user.email, user.displayName, Date.now()).run();
  return user;
}

export function splitIntoChunks(text: string, chunkSize = 1100, overlap = 180) {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length && chunks.length < 500) {
    let end = Math.min(start + chunkSize, clean.length);
    if (end < clean.length) {
      const boundary = Math.max(clean.lastIndexOf('\n', end), clean.lastIndexOf('. ', end));
      if (boundary > start + chunkSize * 0.55) end = boundary + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks.filter(Boolean);
}

export function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}
