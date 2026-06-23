-- ============================================================================
-- 38 — Cron de polling Mews (check-outs → chambres_liberees)  [Les Voiles]
-- ============================================================================
-- Réveille la route /api/mews/poll-checkouts toutes les 5 min sur une fenêtre
-- UTC 04h-14h (= couvre 06h-15h Paris été comme hiver). Le garde-fou horaire
-- FIN (06h-15h Paris exact, DST-safe) est dans la route elle-même : aux bords,
-- l'appel arrive mais la route répond "skipped" sans toucher Mews.
--
-- Mécanisme : pg_cron (planificateur) + pg_net (appel HTTP sortant), tous deux
-- dispo sur Supabase. À jouer dans le SQL Editor. Idempotent (unschedule avant).
--
-- URL = sous-domaine Netlify PERMANENT de l'app consignes (stable même si le
-- domaine custom consigneshtbm.com est down). À mettre à jour si l'app change de
-- site Netlify. (NB : sitehtbm.netlify.app = site vitrine, PAS l'app — ne pas confondre.)
--
-- ⚠️ AVANT DE COLLER, remplacer 1 valeur :
--   __MEWS_POLL_SECRET__ → la valeur de MEWS_POLL_SECRET (cf. .env.local).
--      Cette même valeur doit AUSSI être posée dans les variables d'env Netlify.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotence : retire un éventuel job précédent du même nom.
select cron.unschedule('mews-poll-checkouts')
where exists (select 1 from cron.job where jobname = 'mews-poll-checkouts');

select cron.schedule(
  'mews-poll-checkouts',
  '*/5 4-14 * * *',                       -- toutes les 5 min, 04h-14h UTC
  $$
  select net.http_post(
    url     := 'https://magnificent-gumdrop-4b7f4f.netlify.app/api/mews/poll-checkouts',
    headers := '{"Content-Type":"application/json","x-mews-poll-secret":"__MEWS_POLL_SECRET__"}'::jsonb,
    body    := '{}'::jsonb,
    timeout_milliseconds := 8000
  );
  $$
);

-- Vérif : SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'mews-poll-checkouts';
-- Désactiver à tout moment : SELECT cron.unschedule('mews-poll-checkouts');
