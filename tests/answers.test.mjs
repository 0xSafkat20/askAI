import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(
  new URL('../lib/answers.ts', import.meta.url),
  'utf8',
);
const compile = (source) =>
  ts.transpile(source, {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  });
const answerUrl =
  'data:text/javascript;base64,' +
  Buffer.from(compile(source)).toString('base64');
const { generateAnswer } = await import(answerUrl);
const chunks = [
  {
    documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    filename: 'notes.txt',
    content: 'Learn Python and build an application.',
  },
];

test('busy primary model is retried without changing model names', async (t) => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(url);
    return urls.length === 1
      ? Response.json({}, { status: 503 })
      : Response.json({
          candidates: [
            {
              content: {
                parts: [
                  { text: 'Private thought', thought: true },
                  { text: 'Learn Python [notes.txt].' },
                ],
              },
            },
          ],
        });
  });
  const result = await generateAnswer('Summarize', chunks, {
    apiKey: 'test-key',
  });
  assert.equal(result.mode, 'gemini');
  assert.equal(result.answer, 'Learn Python [notes.txt].');
  assert.equal(urls.length, 2);
  assert.ok(urls[0].includes('gemini-3.6-flash'));
  assert.ok(urls[1].includes('gemini-3.6-flash'));
});
test('retired model retries the current default and normalizes model prefixes', async (t) => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(url);
    return urls.length === 1 ? Response.json({}, { status: 404 })
      : Response.json({ candidates: [{ content: { parts: [{ text: 'Working summary' }] } }] });
  });
  const result = await generateAnswer('Summarize', chunks, { apiKey: 'test', model: ' models/gemini-2.5-flash ' });
  assert.equal(result.answer, 'Working summary');
  assert.ok(urls[0].endsWith('/gemini-2.5-flash:generateContent'));
  assert.ok(urls[1].endsWith('/gemini-3.6-flash:generateContent'));
  assert.equal(urls.length, 2);
});

test('unavailable default does not retry forever', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({}, { status: 404 }));
  const result = await generateAnswer('Summarize', chunks, { apiKey: 'test' });
  assert.equal(result.mode, 'local');
  assert.equal(mock.mock.callCount(), 1);
});

test('provider outage returns a clean retry message', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({}, { status: 503 }),
  );
  const result = await generateAnswer('Summarize', chunks, {
    apiKey: 'test-key',
  });
  assert.equal(result.mode, 'local');
  assert.match(result.warning, /unavailable/);
  assert.match(result.answer, /could not create the requested summary/i);
});
test('invalid key is explained without trying alternate model names', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({}, { status: 403 }),
  );
  const result = await generateAnswer('Summarize', chunks, {
    apiKey: 'bad-key',
  });
  assert.equal(result.mode, 'local');
  assert.match(result.warning, /API key/);
  assert.equal(fetchMock.mock.callCount(), 1);
});
test('history failure does not discard the answer', async () => {
  let route = compile(
    await readFile(
      new URL('../app/api/chat/query/route.ts', import.meta.url),
      'utf8',
    ),
  );
  route = route
    .replace(
      /import \{ env \} from ['"]cloudflare:workers['"];?/,
      'const env = {};',
    )
    .replace(
      /import \{ runtimeEnv \} from ['"]@\/lib\/runtime-env['"];?/,
      'const env = {}; const runtimeEnv = () => env;',
    )
    .replace(
      /import \{[^}]+\} from ['"]@\/lib\/supabase-server['"];?/,
      `
      class ApiError extends Error {}
      const apiRoute = handler => handler;
      const requireApiUser = async () => ({userId:'test', supabase: {
        rpc: async () => ({data: ${JSON.stringify(chunks)}, error:null}),
        from: () => ({insert: async () => ({error: {code:'42501'}})})
      }});
    `,
    )
    .replace(/['"]@\/lib\/answers['"]/, JSON.stringify(answerUrl));
  const { POST } = await import(
    'data:text/javascript;base64,' + Buffer.from(route).toString('base64')
  );
  const response = await POST(
    new Request('http://localhost/api/chat/query', {
      method: 'POST',
      body: JSON.stringify({
        question: 'Summarize',
        documentIds: [chunks[0].documentId],
      }),
    }),
  );
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.historySaved, false);
  assert.match(result.warning, /could not be saved/);
  assert.match(result.answer, /could not create the requested summary/i);
});
