type RuntimeEnv = {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
};

// Vercel exposes environment variables through process.env. The fallback keeps
// the module compatible with local Worker-style runtimes without importing a
// Cloudflare-only module into the Vercel bundle.
export function runtimeEnv(): RuntimeEnv {
  return (typeof process !== 'undefined' ? process.env : {}) as RuntimeEnv;
}
