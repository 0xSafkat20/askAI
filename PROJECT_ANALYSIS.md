# askAI project analysis

> Historical review from 9 September, before the Supabase migration. Findings below describe that earlier version, not the current code. See README.md and PROJECT_STATUS.md for the current architecture and setup. The app now stores original files in Supabase Storage, verifies Supabase sessions, runs automated tests, and builds for Vercel through Nitro.

Reviewed 9 September 2026. Scope: application source, API routes, authentication helper, database schema and migration, styling, configuration, dependency manifest, documentation, and deployment workflow. Shared UI components were included in static checks; this was not an exhaustive audit of third-party dependencies.

## Assessment

askAI is a compact document question-answering prototype with a coherent end-to-end implementation. It builds successfully and passes TypeScript, but needs authentication deployment work, retrieval correctness fixes, resource limits, and automated checks before public release.

## Architecture

- React 19 provides one client-rendered workspace with Chat, Documents, and History views (`app/page.tsx`). View changes use component state, so they are not independently linkable routes.
- Vinext adapts Next-style routing to Vite and Cloudflare Workers. Tailwind and custom CSS provide styling. The page uses native controls and Lucide icons; the large shared UI catalog is largely separate from the main application.
- The browser reads TXT/Markdown and dynamically loads PDF.js for PDFs. It sends both the original file and extracted text to the upload endpoint. Original bytes are discarded after validation.
- D1 stores users, document metadata, overlapping text chunks, and question/answer records. Application queries use prepared SQL directly; a separate Drizzle schema describes the same tables.
- Retrieval loads chunks from selected, owned documents and ranks them by substring matches against English alphanumeric question tokens. Up to six chunks go to Gemini, or three shortened passages are returned in local mode. This is lexical retrieval, without embeddings or conversational memory.
- GitHub Actions installs dependencies, builds, applies D1 migrations, deploys a Worker, and optionally sets the Gemini secret.

## Validation

- `npm run build`: passed, all five build stages. Vinext printed a route-classification notice for `/`; it did not fail the build.
- `npx tsc --noEmit --incremental false`: passed.
- `npm run lint`: 23 reported errors, including four in `app/page.tsx`. The remainder concern shared components and the mobile hook. Several are lint-policy or React compiler diagnostics rather than proven runtime failures.
- Focused execution of the existing chunk function with 600,011 input characters: returned 500 chunks and omitted a marker at the end. This confirms silent truncation.
- No application test suite or test script was found. CI does not run lint, a separate typecheck, or tests.
- Browser interactions, live Gemini responses, deployed authentication, and production D1 were not tested. No live service security test or dependency advisory audit was performed.

## Priority findings

### 1. Production identity needs a trusted gateway — high priority

Evidence: `app/chatgpt-auth.ts` reads `oai-authenticated-user-id` and email directly from request headers. The installed Sites plugin strips those headers and supplies a fixed local identity only in its Vite development middleware. `.github/workflows/deploy.yml` deploys directly through Wrangler; no production identity verification or sign-in handlers are implemented in application routes.

Impact: a bare Worker deployment lacks the expected sign-in flow. If it is publicly reachable without a gateway that strips and replaces identity headers, callers can claim another user ID and pass the ownership filters. The repository does not establish whether such an external gateway exists, so this is a deployment-dependent security risk, not a verified exploit of a live site.

Action: establish the supported production authentication path, prevent direct untrusted origin access, and test forged headers and two-user isolation. Local sign-in uses one fixed development user, not separate real accounts.

### 2. Uploaded content is silently truncated — high priority

Evidence: `lib/server-data.ts:55` stops at 500 chunks; upload always reports the saved document as ready. With a 1,100-character chunk size and 180-character overlap, long inputs can exceed this limit well below the advertised 10 MB file allowance.

Impact: later sections cannot be retrieved, while the user sees a successful upload. Original files are not retained for subsequent reprocessing.

Action: reject over-limit extracted text with a clear message, explicitly report partial indexing, or implement complete bounded ingestion. Test questions whose answers occur at the end of long files.

### 3. Search excludes selected material before ranking — high priority

Evidence: `app/api/chat/query/route.ts:38` silently takes the first 20 IDs. Line 45 limits the unordered SQL result to 1,200 chunks before relevance ranking. The UI selects all documents by default and displays the full selected count.

Impact: selected files beyond 20 are ignored, and a few long documents can crowd other selected documents out of the retrieval candidate set.

Action: enforce visible selection limits and retrieve relevant candidates across all accepted documents, preferably through a suitable text index. Apply a deterministic candidate-selection policy.

### 4. Irrelevant passages are presented as matches — medium priority

Evidence: the scorer in `app/api/chat/query/route.ts` only extracts `[a-z0-9]{3,}` tokens, counts substring matches, and retains chunks with a zero score. Its empty-result check tests whether chunks exist, not whether any matched.

Impact: unrelated questions produce claimed relevant passages in local mode. Bengali and other non-Latin questions can have no searchable tokens and receive arbitrary chunks. Substrings and common question words also distort ranking.

Action: add an explicit no-match response, Unicode-aware tokenization, stopword handling, and evaluated relevance ranking. Benchmark summaries, exact facts, no-answer questions, and the intended languages.

### 5. Upload validation does not bound the extracted-text payload — high priority for public use

Evidence: `app/api/documents/route.ts:19` parses the multipart body before checking file size. Only the uploaded file has an application size check; the separate text field has none. Text supplied by the client is trusted and is not verified against the file. File type validation trusts MIME metadata.

Impact: the 10 MB file limit does not constrain total request parsing or text processing. An authenticated caller can submit large unrelated text, and repeated uploads or AI requests have no application rate limit or user quota.

Action: enforce request and extracted-text limits, document/chunk quotas, and rate limits before expensive work. Treat document contents as untrusted input. Browser extraction is an acceptable design choice if these trust boundaries are explicit.

### 6. Supported files can fail because extension and MIME checks differ — medium priority

Evidence: `app/page.tsx` accepts by filename extension, but `app/api/documents/route.ts:24` requires one of three exact MIME strings. PDF extraction also branches on MIME rather than extension.

Impact: a valid Markdown file with an empty or alternate MIME type is rejected; a PDF with an unrecognized MIME can take the plain-text extraction path. Actual browser MIME behavior was not exercised.

Action: define one consistent format policy across client and server, with suitable file-content validation and clear errors.

### 7. Retention differs from the documentation — medium priority

Evidence: `app/api/chat/history/route.ts:8` returns the latest 40 rows, but chat insertion never prunes older records. Document deletion removes documents/chunks through the schema relationships but does not remove excerpts retained in chat answers or their JSON source IDs.

Impact: storage continues growing beyond 40 chats. Deleting an uploaded document does not erase all derived content. Older source labels disappear from history after document deletion because names are resolved from the current document list.

Action: define and implement retention and deletion semantics. Distinguish a display limit from a storage limit in the README.

### 8. Partial failures and concurrent UI operations can mislead users — medium priority

- `app/page.tsx:194`: any successful upload replaces earlier per-file errors with a success notice. A mixed batch hides which files failed.
- `app/page.tsx:208`: failed deletion restores a full earlier document-array snapshot. If an upload or another deletion finishes meanwhile, the rollback can hide new state or restore an already-deleted entry until reload.
- Answer generation and the subsequent history refresh share one try/catch. If the answer succeeds but history loading fails, an additional assistant error appears after a valid answer.
- Clear History empties persisted history and the history panel, but leaves the current chat messages visible.

Action: track per-file results, rollback only the affected document, separate answer errors from history-refresh errors, and define the intended clear-history behavior.

### 9. Database initialization is fragile and duplicated — medium priority

Evidence: `lib/server-data.ts` caches the schema-initialization promise permanently, including rejection. Schema definitions exist in runtime SQL, Drizzle, and migration SQL. Runtime queries write millisecond timestamps while Drizzle columns use `mode: 'timestamp'`, whose mapping is intended for seconds; the Drizzle accessor is currently unused by the routes.

Impact: a transient initialization failure can poison later requests in that isolate. Future schema edits can drift between representations; future adoption of the typed accessor needs timestamp-unit alignment.

Action: make migrations the production schema authority, retry transient initialization safely, and standardize timestamp units before mixing access patterns.

### 10. AI reliability and source inspection are basic — medium priority

- Gemini fetch has no explicit application deadline or retry policy; failure gives a generic 502 without local fallback.
- Questions and document text share a single user prompt with the behavioral instructions. Uploaded instructions can influence answers; no adversarial source tests exist.
- Source labels identify retrieved filenames, not verified citations supporting individual claims. There are no page numbers or a passage viewer.
- Local mode displays three passages but source labels are derived from all six ranked chunks.
- Prior messages are not sent to the model, so follow-ups such as “explain that further” lack conversation context.
- The configured default model is `gemini-3.7-flash`; availability and account access were not verified against a live provider.

Action: add an application timeout, meaningful provider-error handling, clearly separate instructions from untrusted context, and preserve passage/page provenance. Decide whether the product promises independent questions or conversational follow-ups.

## UX and maintainability

- Useful existing states include initial loading, empty document/history lists, upload progress, answer progress, success/error notices, filename search, and mobile layout rules.
- Search is filename-only. README claims of drag-and-drop and suggested learning prompts are not backed by handlers or prompt controls in the current page.
- No sign-out or account identity control is exposed in the current UI, although a sign-out helper exists.
- Document selection buttons change their accessible label but expose no checked/pressed state. Main navigation lacks current-view semantics. The message list has no live-region announcement or automatic scroll-to-new-message behavior.
- The stylesheet contains a responsive breakpoint at 760 px, but actual small-screen layout and keyboard/screen-reader behavior remain unverified.
- All workspace orchestration, extraction, and panels live in one page module. Splitting API helpers, upload handling, and view components would make meaningful tests easier as the app grows.
- Geist fonts are configured in the layout, while the stylesheet explicitly selects Arial. Reconcile the intended typography.
- The package manifest contains a broad component/tool catalog. Measure the actual bundle before pruning; declared dependencies alone do not prove browser bundle bloat.

## What is already sound

- API operations check for a user, and document retrieval/deletion and chat access use user-scoped predicates.
- SQL values use bound parameters; document IDs are not interpolated directly into query text.
- The schema includes ownership relationships, cascading document-chunk deletion, and useful user/date and document/position indexes.
- The Gemini key remains server-side, and only selected retrieved chunks are sent to the provider.
- React renders answers and filenames as text; the current page does not inject them as raw HTML.
- Extraction avoids sending an entire original document to Gemini. PDF.js is dynamically imported.
- The repository has a lockfile, strict TypeScript configuration, migration SQL, and a successful production build.

## Recommended order

1. Resolve the production authentication trust boundary and validate tenant isolation.
2. Fix silent truncation, selection limits, no-match retrieval, and MIME inconsistencies.
3. Bound requests and storage, add rate limits, and define deletion/retention behavior.
4. Add focused tests for those failure modes, then require lint and typecheck in CI before deployment.
5. Improve source provenance, AI timeout/error behavior, mixed-upload feedback, and accessibility.
6. Refactor only where needed to support these changes, and update README/status claims to match verified behavior.

No application-source fixes or deployment changes were made as part of this analysis.
