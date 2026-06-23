-- ============================================================================
-- Bucket wifi-images : policies d'écriture pour authenticated
-- ============================================================================
-- Incident 2026-06-12 : upload d'image impossible depuis /wifi-admin
-- (bulle "Heure du goûter" et toutes les autres) — l'API storage renvoie
-- 403 "new row violates row-level security policy", y compris pour un
-- utilisateur authentifié (reproduit en live le 2026-06-12).
--
-- Cause : le bucket wifi-images n'a AUCUNE policy INSERT/UPDATE/DELETE sur
-- storage.objects. La Phase 1.C (03_phase1_bucket_wifi_images.sql) avait
-- supprimé la SELECT policy publique ; les policies d'écriture ont disparu
-- au passage (ou n'ont jamais été recréées côté dashboard).
--
-- Fix : même pattern que 09_haccp_documents_rls.sql — authenticated peut
-- lire/écrire dans CE bucket uniquement. La lecture publique des images
-- continue de passer par bucket.public = true (getPublicUrl), on ne
-- réintroduit PAS de SELECT policy pour anon (warning Phase 1.C).
--
-- Idempotent. À coller dans le SQL editor Supabase.
-- ============================================================================

drop policy if exists "wifi_images_select" on storage.objects;
create policy "wifi_images_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'wifi-images');

drop policy if exists "wifi_images_insert" on storage.objects;
create policy "wifi_images_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'wifi-images');

drop policy if exists "wifi_images_update" on storage.objects;
create policy "wifi_images_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'wifi-images');

drop policy if exists "wifi_images_delete" on storage.objects;
create policy "wifi_images_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'wifi-images');

-- Vérification : doit retourner 4 lignes (select/insert/update/delete)
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname like 'wifi_images_%'
order by policyname;
