import { env } from 'cloudflare:workers';
import { jsonError, requireApiUser } from '@/lib/server-data';

type Chunk = { documentId: string; filename: string; content: string };

function score(content: string, question: string) {
  const words = [...new Set(question.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])];
  const haystack = content.toLowerCase();
  return words.reduce((total, word) => total + (haystack.includes(word) ? 1 + Math.min(3, haystack.split(word).length - 1) : 0), 0);
}

async function generateAnswer(question: string, chunks: Chunk[]) {
  const context = chunks.map((chunk, index) => `[Source ${index + 1}: ${chunk.filename}]\n${chunk.content}`).join('\n\n');
  if (!env.GEMINI_API_KEY) {
    return `I found these relevant passages in your documents:\n\n${chunks.slice(0, 3).map(chunk => `• ${chunk.content.slice(0, 420)}${chunk.content.length > 420 ? '…' : ''}`).join('\n\n')}\n\nAdd a Gemini API key when you want a synthesized AI explanation; local retrieval is working without one.`;
  }
  const model = env.GEMINI_MODEL || 'gemini-3.7-flash';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `You are askAI. Answer only from the supplied sources. If the sources do not answer the question, say so clearly. Cite sources inline by filename.\n\nQuestion: ${question}\n\nSources:\n${context}` }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 900 },
    }),
  });
  if (!response.ok) throw new Error(`Gemini request failed: ${response.status}`);
  const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const answer = data.candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join('').trim();
  if (!answer) throw new Error('Gemini returned an empty answer');
  return answer;
}

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (!user) return jsonError('Please sign in before asking questions.', 401);
  const body = await request.json().catch(() => null) as { question?: unknown; documentIds?: unknown } | null;
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  const documentIds = Array.isArray(body?.documentIds) ? body.documentIds.filter((id): id is string => typeof id === 'string').slice(0, 20) : [];
  if (!question || question.length > 1200) return jsonError('Enter a question of 1–1200 characters.', 400);
  if (!documentIds.length) return jsonError('Select at least one document.', 400);

  const placeholders = documentIds.map(() => '?').join(',');
  const rows = await env.DB.prepare(`SELECT c.document_id AS documentId, d.filename, c.content
    FROM document_chunks c JOIN documents d ON d.id = c.document_id
    WHERE d.user_id = ? AND d.id IN (${placeholders}) LIMIT 1200`)
    .bind(user.userId, ...documentIds).all<Chunk>();
  const ranked = rows.results.map(chunk => ({ chunk, score: score(chunk.content, question) }))
    .sort((a, b) => b.score - a.score).slice(0, 6).map(item => item.chunk);
  if (!ranked.length) return jsonError('No readable content was found in the selected documents.', 422);

  try {
    const answer = await generateAnswer(question, ranked);
    const sourceIds = [...new Set(ranked.map(chunk => chunk.documentId))];
    await env.DB.prepare(`INSERT INTO chats (id, user_id, question, answer, source_document_ids, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), user.userId, question, answer, JSON.stringify(sourceIds), Date.now()).run();
    return Response.json({ answer, sourceIds, sources: [...new Set(ranked.map(chunk => chunk.filename))], mode: env.GEMINI_API_KEY ? 'gemini' : 'local' });
  } catch (error) {
    console.error('Answer generation failed', error);
    return jsonError('The answer service is temporarily unavailable. Your documents are safe.', 502);
  }
}
