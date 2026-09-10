import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

await test('chunking preserves the end of long documents and respects chunk size', async () => {
  const source = await readFile(
    new URL('../lib/server-data.ts', import.meta.url),
    'utf8',
  );
  const compiled = ts.transpile(source, {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  });
  const { splitIntoChunks } = await import(
    'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
  );
  const chunks = splitIntoChunks('a'.repeat(600000) + 'TAIL_MARKER');
  assert.ok(chunks.length > 500);
  assert.ok(chunks.at(-1).endsWith('TAIL_MARKER'));
  assert.ok(
    splitIntoChunks('a'.repeat(1100) + '\nend').every((c) => c.length <= 1100),
  );
  assert.deepEqual(splitIntoChunks('  \n '), []);
});

await test('Supabase migration: atomic saves, retrieval and tenant policies', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  // Model Supabase-owned auth/storage schemas; the real migration is applied unchanged.
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    create function storage.foldername(text) returns text[] language sql immutable as
      $$ select string_to_array($1, '/') $$;
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select, insert, delete on storage.objects to authenticated;
  `);
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/202609090001_initial.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const alice = '11111111-1111-4111-8111-111111111111';
  const bob = '22222222-2222-4222-8222-222222222222';
  const doc = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const brokenDoc = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await db.query('insert into auth.users(id) values ($1),($2)', [alice, bob]);
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
    alice,
  ]);

  await t.test('owner can save a file and its searchable chunks', async () => {
    await db.query('select public.save_document($1,$2,$3,$4,$5,$6)', [
      doc,
      'notes.md',
      alice + '/' + doc + '/original.md',
      'text/markdown',
      12,
      ['ordinary opening', 'uniqueanswer is at the ending'],
    ]);
    assert.equal(
      (await db.query('select * from public.documents')).rows.length,
      1,
    );
    assert.equal(
      (await db.query('select * from public.document_chunks')).rows.length,
      2,
    );
    const result = await db.query(
      'select * from public.match_document_chunks($1,$2)',
      [[doc], 'uniqueanswer'],
    );
    assert.equal(result.rows[0].content, 'uniqueanswer is at the ending');
    await db.query(
      'insert into public.chats(question,answer,source_document_ids) values ($1,$2,$3)',
      ['question', 'answer', [doc]],
    );
    await db.query(
      'insert into storage.objects(bucket_id,name) values ($1,$2)',
      ['documents', alice + '/' + doc + '/original.md'],
    );
  });
  await t.test('bad chunks roll the entire metadata save back', async () => {
    await assert.rejects(
      db.query('select public.save_document($1,$2,$3,$4,$5,$6)', [
        brokenDoc,
        'bad.md',
        alice + '/' + brokenDoc + '/original.md',
        'text/markdown',
        12,
        ['valid', ''],
      ]),
    );
    assert.equal(
      (
        await db.query('select * from public.documents where id=$1', [
          brokenDoc,
        ])
      ).rows.length,
      0,
    );
  });
  await t.test(
    'another user cannot see, mutate or impersonate the owner',
    async () => {
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
        bob,
      ]);
      for (const table of [
        'public.documents',
        'public.document_chunks',
        'public.chats',
        'storage.objects',
      ]) {
        assert.equal((await db.query('select * from ' + table)).rows.length, 0);
      }
      assert.equal(
        (
          await db.query('select * from public.match_document_chunks($1,$2)', [
            [doc],
            'uniqueanswer',
          ])
        ).rows.length,
        0,
      );
      assert.equal(
        (
          await db.query(
            'delete from public.documents where id=$1 returning id',
            [doc],
          )
        ).rows.length,
        0,
      );
      await assert.rejects(
        db.query(
          'insert into public.chats(user_id,question,answer) values ($1,$2,$3)',
          [alice, 'forged', 'answer'],
        ),
      );
      await assert.rejects(
        db.query(
          'insert into public.document_chunks(document_id,position,content) values ($1,2,$2)',
          [doc, 'forged'],
        ),
      );
      await assert.rejects(
        db.query('insert into storage.objects(bucket_id,name) values ($1,$2)', [
          'documents',
          alice + '/forged.md',
        ]),
      );
    },
  );
  await t.test(
    'owner can clear history and delete original metadata/chunks',
    async () => {
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
        alice,
      ]);
      assert.equal(
        (await db.query('select * from public.chats')).rows.length,
        1,
      );
      await db.exec(
        'delete from public.chats; delete from storage.objects; delete from public.documents;',
      );
      assert.equal(
        (await db.query('select * from public.document_chunks')).rows.length,
        0,
      );
    },
  );
  await t.test('anonymous role cannot query application records', async () => {
    await db.exec('reset role; set role anon;');
    await assert.rejects(db.query('select * from public.documents'));
    await assert.rejects(
      db.query('select * from public.match_document_chunks($1,$2)', [
        [doc],
        'question',
      ]),
    );
  });
});
