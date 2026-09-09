import { ApiError, apiRoute, requireApiUser } from '@/lib/supabase-server';
import { runtimeEnv } from '@/lib/runtime-env';

import { generateAnswer, type Chunk } from '@/lib/answers';

export const POST = apiRoute(async (request) => {
  const env = runtimeEnv();
  const { userId, supabase } = await requireApiUser(request);
  const body = (await request.json().catch(() => null)) as {
    question?: unknown;
    documentIds?: unknown;
  } | null;
  const question =
    typeof body?.question === 'string' ? body.question.trim() : '';
  const documentIds = Array.isArray(body?.documentIds) ? body.documentIds : [];
  if (!question || question.length > 1200)
    throw new ApiError('Enter a question of 1–1200 characters.', 400);
  if (
    !documentIds.length ||
    documentIds.length > 20 ||
    documentIds.some(
      (id) =>
        typeof id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        ),
    )
  )
    throw new ApiError('Select between 1 and 20 valid documents.', 400);
  const { data, error } = await supabase.rpc('match_document_chunks', {
    p_document_ids: documentIds,
    p_question: question,
  });
  if (error) throw error;
  const ranked = data as Chunk[];
  if (!ranked.length)
    throw new ApiError(
      'No readable content was found in the selected documents.',
      422,
    );

  const result = await generateAnswer(question, ranked, {
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL,
  });
  const { answer } = result;
  const sourceIds = [...new Set(ranked.map((chunk) => chunk.documentId))];
  let historySaved = false;
  try {
    const saved = await supabase.from('chats').insert({
      user_id: userId,
      question,
      answer,
      source_document_ids: sourceIds,
    });
    if (saved.error) throw saved.error;
    historySaved = true;
  } catch {
    console.warn('Chat history save failed');
  }
  return Response.json({
    answer,
    sourceIds,
    sources: [...new Set(ranked.map((chunk) => chunk.filename))],
    mode: result.mode,
    historySaved,
    warning:
      [
        result.warning,
        !historySaved
          ? 'This answer could not be saved to history. Copy it before leaving this page.'
          : '',
      ]
        .filter(Boolean)
        .join(' ') || undefined,
  });
});
