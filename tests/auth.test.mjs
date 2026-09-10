import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

await test('API verifies bearer tokens, ignores identity headers, and protects configuration', async (t) => {
  const source = await readFile(
    new URL('../lib/supabase-server.ts', import.meta.url),
    'utf8',
  );
  const compiled = ts
    .transpile(source, {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    })
    .replace(
      /import \{ env \} from ['"]cloudflare:workers['"];?/,
      'export const env = {};',
    )
    .replace(
      /import \{ runtimeEnv \} from ['"]@\/lib\/runtime-env['"];?/,
      'export const env = {}; export const runtimeEnv = () => env;',
    )
    .replace(
      /['"]@supabase\/supabase-js['"]/,
      JSON.stringify(import.meta.resolve('@supabase/supabase-js')),
    );
  const serverModule = await import(
    'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
  );
  const { env, supabaseConfig, requireApiUser, apiRoute } = serverModule;
  const endpoint = apiRoute(async (request) => {
    const { userId } = await requireApiUser(request);
    return Response.json({ userId });
  });
  const configEndpoint = apiRoute(async () => Response.json(supabaseConfig()));
  assert.equal(
    (await configEndpoint(new Request('http://localhost/api/auth/config')))
      .status,
    503,
  );
  env.SUPABASE_URL = 'https://example.supabase.co';
  env.SUPABASE_PUBLISHABLE_KEY = 'sb_secret_must_not_be_exposed';
  const secretResult = await configEndpoint(new Request('http://localhost'));
  assert.equal(secretResult.status, 503);
  assert.ok(
    !(await secretResult.text()).includes('sb_secret_must_not_be_exposed'),
  );
  env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  let authCalls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    authCalls++;
    const authorization = new Headers(options?.headers).get('authorization');
    if (authorization !== 'Bearer verified-token')
      return Response.json({ message: 'invalid token' }, { status: 401 });
    return Response.json({
      id: '11111111-1111-4111-8111-111111111111',
      aud: 'authenticated',
      email: 'user@example.test',
    });
  });
  const forged = await endpoint(
    new Request('http://localhost', {
      headers: {
        'oai-authenticated-user-id': 'forged',
        'oai-authenticated-user-email': 'forged@example.test',
      },
    }),
  );
  assert.equal(forged.status, 401);
  assert.equal(authCalls, 0);
  const missingRequest = await endpoint(undefined);
  assert.equal(missingRequest.status, 400);
  assert.equal((await missingRequest.json()).error, 'Invalid request context.');
  const invalid = await endpoint(
    new Request('http://localhost', {
      headers: { Authorization: 'Bearer invalid-token' },
    }),
  );
  assert.equal(invalid.status, 401);
  const valid = await endpoint(
    new Request('http://localhost', {
      headers: { Authorization: 'Bearer verified-token' },
    }),
  );
  assert.equal(valid.status, 200);
  assert.equal(
    (await valid.json()).userId,
    '11111111-1111-4111-8111-111111111111',
  );
  assert.equal(valid.headers.get('cache-control'), 'private, no-store');
  assert.equal(authCalls, 2);
});
