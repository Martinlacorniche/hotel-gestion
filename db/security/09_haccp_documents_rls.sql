-- ============================================================================
-- HACCP Documents — RLS policies
-- ============================================================================
-- Table haccp_documents : pattern uniforme du repo (authenticated_all).
-- Bucket Storage haccp-documents : policies sur storage.objects pour permettre
-- aux authenticated d'uploader, lire et supprimer dans ce bucket spécifique
-- (le bucket lui-même est privé, donc pas d'accès anon).
--
-- Idempotent.
-- ============================================================================

-- 1) RLS sur la table
alter table public.haccp_documents enable row level security;

drop policy if exists "authenticated_all" on public.haccp_documents;
create policy "authenticated_all" on public.haccp_documents
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- 2) RLS Storage : autoriser authenticated à lire/écrire dans le bucket haccp-documents
-- Note : storage.objects n'a pas enable rls do/end, c'est déjà actif au niveau bucket privé.
-- On définit juste les policies par opération.

drop policy if exists "haccp_documents_select" on storage.objects;
create policy "haccp_documents_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'haccp-documents');

drop policy if exists "haccp_documents_insert" on storage.objects;
create policy "haccp_documents_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'haccp-documents');

drop policy if exists "haccp_documents_update" on storage.objects;
create policy "haccp_documents_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'haccp-documents');

drop policy if exists "haccp_documents_delete" on storage.objects;
create policy "haccp_documents_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'haccp-documents');

-- 3) Vérification
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname like 'haccp_documents_%'
order by policyname;
