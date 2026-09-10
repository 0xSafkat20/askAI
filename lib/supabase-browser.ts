import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let clientPromise: Promise<SupabaseClient> | undefined;
let refreshPromise: ReturnType<SupabaseClient['auth']['refreshSession']> | undefined;

async function bounded<T>(operation: PromiseLike<T>, milliseconds = 30_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('The connection timed out. Please check your connection and try again.')), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function getSupabaseBrowser() {
  clientPromise ??= (async () => {
    const response = await fetch('/api/auth/config', { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
    const config = (await response.json()) as {
      url: string;
      key: string;
      error?: string;
    };
    if (!response.ok)
      throw new Error(config.error || 'Unable to load sign-in configuration.');
    return createClient(config.url, config.key, {
      global: { fetch: (input, init) => fetch(input, {
        ...init,
        signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
      }) },
    });
  })().catch((error: unknown) => {
    clientPromise = undefined;
    throw error;
  });
  return clientPromise;
}
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const supabase = await getSupabaseBrowser();
  const {
    data: { session },
    error,
  } = await bounded(supabase.auth.getSession());
  if (error || !session) throw new Error('Please sign in to continue.');
  const headers = new Headers(options?.headers);
  headers.set('Authorization', `Bearer ${session.access_token}`);
  const send = () => fetch(url, { ...options, headers,
    signal: options?.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
  });
  let response = await send();
  // A rejected token is checked before route mutations. Retry only this case,
  // never an ambiguous upload timeout that may already have saved the file.
  if (response.status === 401) {
    refreshPromise ??= supabase.auth.refreshSession().finally(() => { refreshPromise = undefined; });
    const refreshed = await bounded(refreshPromise);
    if (refreshed.error) throw new Error(refreshed.error.message);
    if (!refreshed.data.session) throw new Error('Please sign in again to continue.');
    headers.set('Authorization', `Bearer ${refreshed.data.session.access_token}`);
    response = await send();
  }
  const raw = await response.text();
  let data: T & { error?: string } = {} as T & { error?: string };
  try {
    data = JSON.parse(raw) as T & { error?: string };
  } catch {
    if (response.ok) {
      throw new Error('The server returned an invalid response. Check that the deployed API routes are running.');
    }
  }
  if (!response.ok) {
    if (response.status === 413) {
      throw new Error('The server rejected the upload because it is too large. Try a smaller document.');
    }
    const fallback = raw
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    throw new Error(
      data.error ||
        fallback.slice(0, 240) ||
        `Request failed (${response.status}).`,
    );
  }
  return data;
}
