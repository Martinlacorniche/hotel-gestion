-- ============================================================================
-- Bucket groupe-images : photos de couverture / personnalisation des groupes
-- ============================================================================
-- Même pattern que clim-photos (15_clim_photos_storage.sql) :
--   - bucket PUBLIC (lecture des images via getPublicUrl côté page invité,
--     sans SELECT policy pour anon → pas de listing public)
--   - authenticated (back-office) peut lire/écrire/supprimer dans CE bucket
--
-- La page invité (Site-BW) lit la cover via l'URL publique : aucune policy anon
-- nécessaire. Idempotent. À coller dans le SQL editor (après la migration 23).
-- ============================================================================

-- 1) Créer le bucket public (idempotent)
insert into storage.buckets (id, name, public)
values ('groupe-images', 'groupe-images', true)
on conflict (id) do update set public = true;

-- 2) Policies d'écriture/lecture pour authenticated sur ce bucket
drop policy if exists "groupe_images_select" on storage.objects;
create policy "groupe_images_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'groupe-images');

drop policy if exists "groupe_images_insert" on storage.objects;
create policy "groupe_images_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'groupe-images');

drop policy if exists "groupe_images_update" on storage.objects;
create policy "groupe_images_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'groupe-images');

drop policy if exists "groupe_images_delete" on storage.objects;
create policy "groupe_images_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'groupe-images');

-- Vérification : doit retourner 4 lignes (select/insert/update/delete)
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname like 'groupe_images_%'
order by policyname;
