# askAI

Upload PDF, TXT, and Markdown documents, save their original files, and ask questions about extracted text.

## Supabase setup

1. Create a Supabase project.
2. Open its SQL Editor and run `supabase/migrations/202609090001_initial.sql` once. This creates the Postgres tables, functions, ownership policies, and private `documents` storage bucket.
3. Copy `.env.example` to `.env.local`. Set `SUPABASE_URL` to the project URL and `SUPABASE_PUBLISHABLE_KEY` to the publishable key from the project's API settings. The legacy anon key also works. Never use a secret or service-role key.
4. In Supabase Authentication, enable Email/password sign-in. Set Site URL to `http://localhost:3000` for local development and allow that origin as an authentication redirect URL. Add your deployed URL before deploying. Email confirmation can remain enabled; users must follow the confirmation email before signing in.
5. Run `npm install`, then `npm run dev` (Node 22.13+). Open the printed local URL, create an account, confirm the email, and sign in.
6. Upload a file, ask a question, reload to verify saved history, and use the document's download button to retrieve its original.

If a `.dev.vars` file already exists, Wrangler may prefer it over `.env.local`; keep the runtime variables together in that file instead. Restart development after changing configuration.

The project code is ready to connect, but it cannot create your remote Supabase project or apply SQL without access to your account.

## Storage and authentication

- Supabase Auth manages email/password accounts and browser session refresh.
- Browser API calls send the current access token; the server verifies it with Supabase Auth.
- Postgres Row Level Security scopes documents, chunks, and chats to the authenticated user. Storage policies restrict files to the user's folder.
- Original bytes are stored in a private bucket at `user-id/document-id/original.extension`.
- Document metadata and extracted text are saved atomically by the `save_document` function. Failed database saves trigger a best-effort file cleanup.
- Downloads use owner-checked signed URLs valid for 60 seconds.
- Deletion removes the original file and document/chunks. Previously saved chat answers remain until Clear history is used.
- History shows the latest 40 questions; older rows remain stored until cleared.
- Uploads are limited to 10 MB and 400,000 extracted characters, with an explicit error instead of silently discarding text. Scanned PDFs need OCR outside this app.
- Queries accept up to 20 documents. Postgres ranks all their chunks before returning six; this is lexical retrieval, not embeddings. When question terms do not match, document openings provide fallback context for general questions.

## Optional Gemini

Set `GEMINI_API_KEY` and optionally `GEMINI_MODEL` in the runtime environment to enable generated answers. Without a key, askAI returns document passages. The Gemini key stays server-side. Verify model availability for your account; provider errors are shown in the app.

## Verification

- `npm run typecheck`
- `npm test` — embedded Postgres tests for migration, RLS isolation, atomic chunk saves, retrieval, and storage policies, plus chunking regression tests.
- `npm run build`
- `npm run lint` — the inherited shared UI catalog has existing lint errors; this is not yet a clean CI gate.

For a real project, also test two Supabase accounts: each should see only their own files/history, and should be unable to download or delete the other's documents.

## Deployment

### Deploy to Vercel (recommended for this Supabase version)

Import the repository in Vercel and keep the detected Node.js version at 22 or newer. Add these Environment Variables for Preview and Production:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `GEMINI_API_KEY` (optional)
- `GEMINI_MODEL` (optional; defaults to `gemini-2.5-flash`)

Apply the Supabase SQL migration before the first upload. In Supabase Authentication URL Configuration, set the production Site URL to your Vercel domain and add that domain to the redirect allowlist. Deploy with the Vercel dashboard or `npx vercel --prod`.

The Vercel build uses the same server API routes and Supabase Row Level Security. Do not add a Supabase service-role key to Vercel or the browser.

The app still runs on Cloudflare Workers; Supabase replaces D1 and supplies storage/authentication.

Apply the SQL migration to Supabase first. Set GitHub repository secrets `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY`. Optionally set `GEMINI_API_KEY`. The workflow validates, builds, and deploys without D1 bindings or migrations. Supabase URL and publishable key are intentionally public client configuration; never put an admin key there.

Configure Supabase's production Site URL, redirect allowlist, and email delivery settings for your domain. Before a public launch add request/rate limits, user storage quotas, and an explicit retention policy.

## Previous D1 data

Old D1 data is not automatically migrated, and Supabase identities differ from the previous local/Sites identities. The legacy SQLite schema and migration remain under `db/schema.ts` and `drizzle/` only as a reference for a separate export/import. The running app does not use them. Original files were not stored by the earlier version and must be uploaded again.

The SQL migration is for a fresh Supabase project. Do not rerun it or apply it over unrelated tables with the same names.
