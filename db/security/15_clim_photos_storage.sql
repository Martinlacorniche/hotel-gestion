-- ============================================================================
-- Bucket clim-photos : stockage des photos d'incidents clim (onglet Voiles)
-- ============================================================================
-- Même pattern que wifi-images (03_phase1_bucket_wifi_images.sql +
-- 13_wifi_images_storage_rls.sql) :
--   - bucket PUBLIC (lecture des images via getPublicUrl, sans SELECT policy
--     pour anon → pas de listing public)
--   - authenticated peut lire/écrire/supprimer dans CE bucket uniquement
--
-- Idempotent. À coller dans le SQL editor Supabase (après la migration 20).
-- ============================================================================

-- 1) Créer le bucket public (idempotent)
insert into storage.buckets (id, name, public)
values ('clim-photos', 'clim-photos', true)
on conflict (id) do update set public = true;

-- 2) Policies d'écriture/lecture pour authenticated sur ce bucket
drop policy if exists "clim_photos_select" on storage.objects;
create policy "clim_photos_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'clim-photos');

drop policy if exists "clim_photos_insert" on storage.objects;
create policy "clim_photos_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'clim-photos');

drop policy if exists "clim_photos_update" on storage.objects;
create policy "clim_photos_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'clim-photos');

drop policy if exists "clim_photos_delete" on storage.objects;
create policy "clim_photos_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'clim-photos');

-- Vérification : doit retourner 4 lignes (select/insert/update/delete)
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname like 'clim_photos_%'
order by policyname;
