import { createClient } from '@supabase/supabase-js';
import { runtimeEnv } from '@/lib/runtime-env';

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 500,
  ) {
    super(message);
  }
}
export function supabaseConfig() {
  const env = runtimeEnv();
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    throw new ApiError(
      'Supabase is not configured. Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY, then restart the app.',
      503,
    );
  if (!key.startsWith('sb_publishable_')) {
    try {
      const payload = JSON.parse(
        atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
      ) as { role?: string };
      if (payload.role !== 'anon') throw new Error('Not anon');
    } catch {
      throw new ApiError('Use a Supabase publishable or legacy anon key.', 503);
    }
  }
  return { url, key };
}
export async function requireApiUser(request: Request | undefined) {
  if (!(request instanceof Request)) {
    throw new ApiError('Invalid request context.', 400);
  }
  const token = request.headers
    .get('authorization')
    ?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) throw new ApiError('Please sign in to continue.', 401);
  const { url, key } = supabaseConfig();
  const supabase = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user)
    throw new ApiError('Your session has expired. Please sign in again.', 401);
  return { userId: data.user.id, supabase };
}
export function apiRoute(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    try {
      const response = await handler(request);
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    } catch (error) {
      if (!(error instanceof ApiError))
        console.error('API request failed', error);
      const message =
        error instanceof ApiError
          ? error.message
          : error &&
              typeof error === 'object' &&
              'message' in error &&
              typeof error.message === 'string'
            ? error.message
            : 'The request could not be completed. Please try again.';
      return Response.json(
        {
          error: message,
        },
        {
          status: error instanceof ApiError ? error.status : 502,
          headers: { 'Cache-Control': 'private, no-store' },
        },
      );
    }
  };
}
