import { env } from 'cloudflare:workers';
import { jsonError, requireApiUser } from '@/lib/server-data';

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (!user) return jsonError('Please sign in before deleting documents.', 401);
  const { id } = await context.params;
  const record = await env.DB.prepare('SELECT object_key AS objectKey FROM documents WHERE id = ? AND user_id = ?')
    .bind(id, user.userId).first<{ objectKey: string }>();
  if (!record) return jsonError('Document not found.', 404);
  await env.FILES.delete(record.objectKey);
  await env.DB.prepare('DELETE FROM documents WHERE id = ? AND user_id = ?').bind(id, user.userId).run();
  return Response.json({ deleted: true });
}
