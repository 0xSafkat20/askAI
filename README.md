# askAI

askAI is a learning project for uploading PDF, TXT, and Markdown files and asking questions about their content.

## What is implemented

- Responsive document-chat dashboard
- Drag-and-drop and file-picker upload with PDF/TXT/Markdown text extraction
- Document search, selection, and deletion
- Source-aware retrieval and chat with loading, empty, success, and error states
- Suggested learning prompts
- Persistent D1 records for users, documents, chunks, and the latest 40 chats
- D1-only storage for extracted document text and metadata
- ChatGPT sign-in foundation for hosted user isolation
- Free local retrieval mode plus optional Gemini answer synthesis
- Account-level ownership checks on every document and chat operation

## Run locally

Requirements: Node.js 22.13 or newer.

```powershell
npm install
npm run dev
```

Open the local address printed by the development server.

## Optional free Gemini API key

1. Visit [Google AI Studio](https://aistudio.google.com/app/apikey) and sign in with a Google account.
2. Select **Create API key** and create one in a new or existing Google Cloud project.
3. Copy `.env.example` to `.env.local`.
4. Paste the key after `GEMINI_API_KEY=`. Do not add quotes and do not share the file or commit it to Git.

Without a key, askAI still retrieves and displays the most relevant passages. With the key, Gemini converts those passages into a concise, source-cited answer. You may override the default model with `GEMINI_MODEL`.

## Data model

Structured records, extracted document chunks, and chat history use D1/SQLite. Original upload bytes are not retained in cloud storage. Every user-owned record includes a user ID so server routes can enforce ownership. The schema lives in `db/schema.ts`.

## Security notes

- Secrets belong only in `.env.local`, never browser code.
- Uploaded file type and size must be checked again on the server before saving.
- All document and chat operations must check the authenticated user ID.
- AI responses should receive only retrieved passages, not entire unrelated files.
- Production deployment should apply rate limits and retain minimal logs.

## Current learning architecture

The browser extracts text from PDF, TXT, and Markdown files. The server validates the upload, stores extracted text as overlapping chunks in D1, and ranks those chunks against each question. Gemini is called only when a server-side key exists; the key is never exposed to browser code.
