export function splitIntoChunks(text: string, chunkSize = 1100, overlap = 180) {
  const clean = text
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + chunkSize, clean.length);
    if (end < clean.length) {
      const boundary = Math.max(
        clean.lastIndexOf('\n', end - 1),
        clean.lastIndexOf('. ', end - 1),
      );
      if (boundary > start + chunkSize * 0.55) end = boundary + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks.filter(Boolean);
}
export const DOCUMENT_FIELDS =
  'id, filename, contentType:content_type, size, status, uploadedAt:uploaded_at';
export const DOCUMENT_BUCKET = 'documents';
