# askAI status

## Implemented
- Supabase email/password signup, signin, persistent sessions, and signout
- Postgres documents, chunks, and saved question/answer history
- Private Supabase Storage for original PDF/TXT/MD files
- Owner-scoped APIs and Row Level Security
- Signed downloads, document deletion, and history clearing
- Browser text extraction with explicit limits
- Postgres lexical retrieval and optional Gemini synthesis
- Cloudflare deployment without D1

## Required setup
- Create a Supabase project and apply supabase/migrations/202609090001_initial.sql.
- Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY to .env.local.
- Configure authentication URLs and email confirmation.
- Test real sign-in, uploads, downloads, and isolation using two accounts.

## Remaining
- Existing D1 data needs a separate migration with identity mapping.
- Public-launch rate limits, quotas, retention policy, and browser end-to-end tests.
- Existing shared UI lint issues.
