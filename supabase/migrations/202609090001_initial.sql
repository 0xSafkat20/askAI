-- Run once in the SQL Editor of your Supabase project.
-- All application access uses user JWTs; no service-role key is required.
begin;
create table public.documents (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  filename text not null check (length(filename) between 1 and 180),
  object_key text not null unique,
  content_type text not null check (content_type in ('application/pdf','text/plain','text/markdown')),
  size bigint not null check (size between 1 and 10485760),
  status text not null default 'ready' check (status in ('ready','processing','failed')),
  uploaded_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  check (split_part(object_key, '/', 1) = user_id::text)
);
create index documents_user_uploaded on public.documents(user_id, uploaded_at desc);
create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  position integer not null check (position >= 0),
  content text not null check (length(content) between 1 and 1100),
  search_vector tsvector generated always as (to_tsvector('simple', content)) stored,
  unique(document_id, position)
);
create index chunks_search on public.document_chunks using gin(search_vector);
create table public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  question text not null check (length(question) between 1 and 1200),
  answer text not null,
  source_document_ids uuid[] not null default '{}',
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);
create index chats_user_created on public.chats(user_id, created_at desc);
alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;
alter table public.chats enable row level security;
create policy documents_owner on public.documents for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy chunks_owner on public.document_chunks for all to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id and d.user_id = (select auth.uid())))
  with check (exists (select 1 from public.documents d where d.id = document_id and d.user_id = (select auth.uid())));
create policy chats_owner on public.chats for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.documents, public.document_chunks, public.chats from anon;
grant select, insert, update, delete on public.documents, public.document_chunks, public.chats to authenticated;

-- Atomic document + chunk insertion. Storage upload is compensated by the API on failure.
create function public.save_document(
  p_id uuid, p_filename text, p_object_key text, p_content_type text,
  p_size bigint, p_chunks text[]
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if coalesce(cardinality(p_chunks), 0) not between 1 and 1000 then
    raise exception 'Invalid chunk count';
  end if;
  if p_object_key not like auth.uid()::text || '/' || p_id::text || '/%' then
    raise exception 'Invalid object ownership';
  end if;
  insert into public.documents(id, user_id, filename, object_key, content_type, size)
    values (p_id, auth.uid(), p_filename, p_object_key, p_content_type, p_size);
  insert into public.document_chunks(document_id, position, content)
    select p_id, (ordinality - 1)::integer, content
    from unnest(p_chunks) with ordinality as chunks(content, ordinality);
end;
$$;
revoke all on function public.save_document(uuid,text,text,text,bigint,text[]) from public, anon;
grant execute on function public.save_document(uuid,text,text,text,bigint,text[]) to authenticated;

-- Rank in Postgres, so the REST row limit never truncates candidates before ranking.
create function public.match_document_chunks(p_document_ids uuid[], p_question text)
returns table ("documentId" uuid, filename text, content text)
language sql stable security invoker set search_path = '' as $$
  with terms as (
    select plainto_tsquery('simple', left(p_question, 1200)) as query
  )
  select d.id, d.filename, c.content
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  cross join terms t
  where d.user_id = auth.uid() and d.id = any(p_document_ids)
    and cardinality(p_document_ids) between 1 and 20
  order by ts_rank(c.search_vector, t.query) desc, d.uploaded_at desc, c.position
  limit 6;
$$;
revoke all on function public.match_document_chunks(uuid[],text) from public, anon;
grant execute on function public.match_document_chunks(uuid[],text) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760, array['application/pdf','text/plain','text/markdown'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
create policy askai_files_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy askai_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy askai_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
commit;
