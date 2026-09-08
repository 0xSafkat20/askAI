# askAI project status

## Ready now

- Account-based local sign-in
- PDF, TXT, and Markdown upload
- File validation and a 10 MB limit
- PDF and text extraction in the browser
- Document storage and searchable chunks
- Document selection, search, and deletion
- Local source retrieval without a paid API
- Optional Gemini-generated answers
- Saved chat history and clear-history control
- Desktop and mobile layouts
- Server-side ownership checks

## Needed before a public release

1. Add a Gemini API key in `.env.local` if generated answers are required.
2. Create the hosted D1 database during deployment.
3. Configure the production Gemini key as a hosted secret.
4. Add rate limiting before allowing many public users.
5. Decide how long uploaded documents and chat history should be retained.
6. Add automated browser tests to CI when this becomes a maintained project.

The application works locally without Gemini by returning the most relevant document passages.
