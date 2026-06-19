-- ============================================================================
-- Bucket groupe-signatures : signatures manuscrites des réservations de groupe
-- ============================================================================
-- Contrairement à groupe-images (cover, public), les signatures sont des
-- données sensibles/juridiques → bucket PRIVÉ.
--   - insert/delete : via service_role (routes API Site-BW, bypass RLS)
--   - select : authenticated uniquement (back-office, via signed URLs en Phase 4)
--   - anon : aucun accès
-- Idempotent. À coller dans le SQL editor Supabase.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('groupe-signatures', 'groupe-signatures', false)
on conflict (id) do update set public = false;

drop policy if exists "groupe_signatures_select" on storage.objects;
create policy "groupe_signatures_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'groupe-signatures');

-- Vérification
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'groupe_signatures_%';
