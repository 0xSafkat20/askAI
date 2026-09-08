declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    GEMINI_API_KEY?: string;
    GEMINI_MODEL?: string;
  }
}
