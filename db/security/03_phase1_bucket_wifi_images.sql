-- ============================================================================
-- Phase 1.C — Bucket wifi-images : supprimer la SELECT policy publique
-- ============================================================================
-- Corrige le warning :
--   public_bucket_allows_listing : "Public bucket wifi-images has 1 broad
--   SELECT policy on storage.objects (public read wifi-images), allowing
--   clients to list all files."
--
-- Le bucket reste public (les URLs renvoyées par getPublicUrl() continuent
-- de fonctionner — elles ne dépendent pas d'une SELECT policy sur
-- storage.objects, juste du flag bucket.public = true).
--
-- Ce qu'on coupe : la possibilité pour un client anon de lister TOUS les
-- objets du bucket via storage.objects (`select * from storage.objects
-- where bucket_id = 'wifi-images'`). Aucun appel `.list()` n'utilise ce
-- bucket dans le code (vérifié 2026-05-14 : seuls upload() et getPublicUrl()
-- dans src/app/wifi-admin/page.tsx, rien côté App-Consignes mobile).
--
-- Idempotent.
-- ============================================================================

drop policy if exists "public read wifi-images" on storage.objects;

-- Vérification : doit retourner 0 ligne après run
select policyname
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname = 'public read wifi-images';
