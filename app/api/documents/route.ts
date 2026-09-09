import {
  DOCUMENT_BUCKET,
  DOCUMENT_FIELDS,
  splitIntoChunks,
} from '@/lib/server-data';
import { ApiError, apiRoute, requireApiUser } from '@/lib/supabase-server';

export const GET = apiRoute(async (request) => {
  const { userId, supabase } = await requireApiUser(request);
  const { data, error } = await supabase
    .from('documents')
    .select(DOCUMENT_FIELDS)
    .eq('user_id', userId)
    .order('uploaded_at', { ascending: false });
  if (error) throw error;
  return Response.json({ documents: data });
});
export const POST = apiRoute(async (request) => {
  const { userId, supabase } = await requireApiUser(request);
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 13 * 1024 * 1024)
    throw new ApiError('The upload payload is too large.', 413);
  const form = await request.formData().catch(() => {
    throw new ApiError('Invalid upload.', 400);
  });
  const file = form.get('file');
  const text = form.get('text');
  if (!(file instanceof File))
    throw new ApiError('Choose a document to upload.', 400);
  const extension = file.name.split('.').pop()?.toLowerCase();
  const contentType = (
    {
      pdf: 'application/pdf',
      txt: 'text/plain',
      md: 'text/markdown',
    } as Record<string, string>
  )[extension || ''];
  if (!contentType)
    throw new ApiError('Only PDF, TXT, and Markdown files are supported.', 415);
  if (!file.size || file.size > 10 * 1024 * 1024)
    throw new ApiError('The file must be between 1 byte and 10 MB.', 413);
  if (
    extension === 'pdf' &&
    !(await file.slice(0, 1024).text()).includes('%PDF-')
  )
    throw new ApiError('The file is not a valid PDF.', 415);
  if (typeof text !== 'string' || !text.trim())
    throw new ApiError(
      'No readable text was found. Scanned PDFs need OCR first.',
      422,
    );
  if (text.length > 400_000)
    throw new ApiError(
      'This document exceeds the 400,000-character text limit. Split it into smaller files.',
      413,
    );
  const chunks = splitIntoChunks(text);
  if (chunks.length > 1000)
    throw new ApiError(
      'This document has too many text sections. Split it into smaller files.',
      413,
    );
  const id = crypto.randomUUID();
  const objectKey = `${userId}/${id}/original.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .upload(objectKey, file, { contentType, upsert: false });
  if (uploadError)
    throw new ApiError(`Storage upload failed: ${uploadError.message}`, 502);
  const { error } = await supabase.rpc('save_document', {
    p_id: id,
    p_filename: file.name.slice(0, 180),
    p_object_key: objectKey,
    p_content_type: contentType,
    p_size: file.size,
    p_chunks: chunks,
  });
  if (error) {
    const cleanup = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .remove([objectKey]);
    if (cleanup.error)
      console.error('Orphan upload cleanup failed', { objectKey });
    throw new ApiError(
      `Document record could not be saved: ${error.message}`,
      502,
    );
  }
  return Response.json(
    {
      document: {
        id,
        filename: file.name.slice(0, 180),
        contentType,
        size: file.size,
        status: 'ready',
        uploadedAt: Date.now(),
      },
      chunkCount: chunks.length,
    },
    { status: 201 },
  );
});
