import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

await test('API refreshes a rejected session once and does not retry failed uploads', async (t) => {
  const source = await readFile(new URL('../lib/supabase-browser.ts', import.meta.url), 'utf8');
  let refreshes = 0;
  const client = { auth: {
    getSession: async () => ({ data: { session: { access_token: 'old' } } }),
    refreshSession: async () => {
      refreshes++;
      return { data: { session: { access_token: 'new' } } };
    },
  } };
  globalThis.__sessionTestClient = client;
  t.after(() => { delete globalThis.__sessionTestClient; });
  const compiled = ts.transpile(source, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 })
    .replace(/import .* from ['"]@supabase\/supabase-js['"];?/, 'const createClient = () => globalThis.__sessionTestClient;');
  const { api } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === '/api/auth/config') return Response.json({ url: 'https://example.test', key: 'test' });
    calls++;
    if (options.headers.get('Authorization') === 'Bearer old') return Response.json({ error: 'expired' }, { status: 401 });
    return Response.json({ documents: [] });
  });
  assert.deepEqual(await api('/api/documents'), { documents: [] });
  assert.equal(refreshes, 1);
  assert.equal(calls, 2);
  calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({ error: 'Storage unavailable' }, { status: 503 });
  });
  await assert.rejects(api('/api/documents', { method: 'POST', body: new FormData() }), /Storage unavailable/);
  assert.equal(calls, 1);
  assert.equal(refreshes, 1);
});
