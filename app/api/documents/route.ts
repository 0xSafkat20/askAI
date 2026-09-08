import { env } from 'cloudflare:workers';
import { jsonError, requireApiUser, splitIntoChunks } from '@/lib/server-data';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED = new Set(['application/pdf', 'text/plain', 'text/markdown']);

export async function GET() {
  const user = await requireApiUser();
  if (!user) return jsonError('Please sign in to view your documents.', 401);
  const rows = await env.DB.prepare(`SELECT id, filename, content_type AS contentType, size, status,
    uploaded_at AS uploadedAt FROM documents WHERE user_id = ? ORDER BY uploaded_at DESC`)
    .bind(user.userId).all();
  return Response.json({ documents: rows.results });
}

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (!user) return jsonError('Please sign in before uploading.', 401);
  const form = await request.formData();
  const file = form.get('file');
  const text = form.get('text');
  const extractedText = typeof text === 'string' ? text.trim() : '';
  if (!(file instanceof File)) return jsonError('Choose a document to upload.', 400);
  if (!ALLOWED.has(file.type)) return jsonError('Only PDF, TXT, and Markdown files are supported.', 415);
  if (!file.size || file.size > MAX_FILE_SIZE) return jsonError('The file must be between 1 byte and 10 MB.', 413);
  if (!extractedText) return jsonError('No readable text was found in this document.', 422);

  const chunks = splitIntoChunks(extractedText);
  if (!chunks.length) return jsonError('No usable text was found in this document.', 422);
  const id = crypto.randomUUID();

  try {
    const statements = [
      env.DB.prepare(`INSERT INTO documents
        (id, user_id, filename, object_key, content_type, size, status, uploaded_at)
        VALUES (?, ?, ?, ?, ?, ?, 'ready', ?)`)
        .bind(id, user.userId, file.name.slice(0, 180), '', file.type, file.size, Date.now()),
      ...chunks.map((content, position) => env.DB.prepare(`INSERT INTO document_chunks
        (id, document_id, position, content) VALUES (?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), id, position, content)),
    ];
    await env.DB.batch(statements);
    return Response.json({ document: { id, filename: file.name, contentType: file.type, size: file.size, status: 'ready', uploadedAt: Date.now() }, chunkCount: chunks.length }, { status: 201 });
  } catch (error) {
    console.error('Document upload failed', error);
    return jsonError('The document could not be saved. Please try again.', 500);
  }
}
