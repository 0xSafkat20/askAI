import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let clientPromise: Promise<SupabaseClient> | undefined;
export function getSupabaseBrowser() {
  clientPromise ??= (async () => {
    const response = await fetch('/api/auth/config', { cache: 'no-store' });
    const config = (await response.json()) as {
      url: string;
      key: string;
      error?: string;
    };
    if (!response.ok)
      throw new Error(config.error || 'Unable to load sign-in configuration.');
    return createClient(config.url, config.key);
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
  } = await supabase.auth.getSession();
  if (error || !session) throw new Error('Please sign in to continue.');
  const headers = new Headers(options?.headers);
  headers.set('Authorization', `Bearer ${session.access_token}`);
  const response = await fetch(url, { ...options, headers });
  const raw = await response.text();
  let data: T & { error?: string } = {} as T & { error?: string };
  try {
    data = JSON.parse(raw) as T & { error?: string };
  } catch {
    // Proxy/runtime errors can be plain text or HTML.
  }
  if (!response.ok) {
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
