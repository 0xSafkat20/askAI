type RuntimeEnv = {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
};

// The Node development and production servers read server-only settings here.
export function runtimeEnv(): RuntimeEnv {
  return (typeof process !== 'undefined' ? process.env : {}) as RuntimeEnv;
}
