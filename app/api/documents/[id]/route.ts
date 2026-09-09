import { DOCUMENT_BUCKET } from '@/lib/server-data';
import { ApiError, apiRoute, requireApiUser } from '@/lib/supabase-server';
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  return apiRoute(async (req) => {
    const { userId, supabase } = await requireApiUser(req);
    const { data, error } = await supabase
      .from('documents')
      .select('object_key, filename')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError('Document not found.', 404);
    const result = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .createSignedUrl(data.object_key, 60, { download: data.filename });
    if (result.error) throw result.error;
    return Response.json({ url: result.data.signedUrl });
  })(request);
}
export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  return apiRoute(async (req) => {
    const { userId, supabase } = await requireApiUser(req);
    const { data, error } = await supabase
      .from('documents')
      .select('object_key')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError('Document not found.', 404);
    // Delete bytes first; leave the record available for retry if SQL fails.
    const removed = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .remove([data.object_key]);
    if (removed.error) throw removed.error;
    const deleted = await supabase
      .from('documents')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    if (deleted.error) throw deleted.error;
    return Response.json({ deleted: true });
  })(request);
}
