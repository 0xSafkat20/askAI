import { apiRoute, supabaseConfig } from '@/lib/supabase-server';
export const GET = apiRoute(async () => Response.json(supabaseConfig()));
