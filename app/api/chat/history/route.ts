import { env } from 'cloudflare:workers';
import { jsonError, requireApiUser } from '@/lib/server-data';

export async function GET() {
  const user = await requireApiUser();
  if (!user) return jsonError('Please sign in to view chat history.', 401);
  const rows = await env.DB.prepare(`SELECT id, question, answer, source_document_ids AS sourceDocumentIds,
    created_at AS createdAt FROM chats WHERE user_id = ? ORDER BY created_at DESC LIMIT 40`)
    .bind(user.userId).all<{ id: string; question: string; answer: string; sourceDocumentIds: string; createdAt: number }>();
  return Response.json({ history: rows.results.map(row => ({ ...row, sourceDocumentIds: JSON.parse(row.sourceDocumentIds) })) });
}

export async function DELETE() {
  const user = await requireApiUser();
  if (!user) return jsonError('Please sign in to clear chat history.', 401);
  await env.DB.prepare('DELETE FROM chats WHERE user_id = ?').bind(user.userId).run();
  return Response.json({ deleted: true });
}
