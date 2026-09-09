import { apiRoute, requireApiUser } from '@/lib/supabase-server';
export const GET = apiRoute(async (request) => {
  const { userId, supabase } = await requireApiUser(request);
  const { data, error } = await supabase
    .from('chats')
    .select(
      'id, question, answer, sourceDocumentIds:source_document_ids, createdAt:created_at',
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(40);
  if (error) throw error;
  return Response.json({ history: data });
});
export const DELETE = apiRoute(async (request) => {
  const { userId, supabase } = await requireApiUser(request);
  const { error } = await supabase.from('chats').delete().eq('user_id', userId);
  if (error) throw error;
  return Response.json({ deleted: true });
});
