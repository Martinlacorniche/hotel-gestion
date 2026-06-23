-- ============================================================================
-- 40 — Cron de rafraîchissement de l'occupation Mews  [Les Voiles]
-- ============================================================================
-- Réveille la route /api/mews/refresh-occupancy toutes les 3 heures. L'occupation
-- "on the books" sur les mois à venir évolue lentement (quelques résas/jour) :
-- toutes les 3 h = données fraîches pour une charge négligeable (2 appels Mews
-- par exécution). Pour changer la cadence, modifier le cron ci-dessous puis
-- rejouer ce script (il est idempotent : unschedule avant schedule).
--
-- Mécanisme : pg_cron + pg_net (cf. migration 38). À jouer dans le SQL Editor.
--
-- URL = sous-domaine Netlify PERMANENT de l'app consignes (stable même si le
-- domaine custom consigneshtbm.com est down). Identique à la migration 38.
--
-- ⚠️ AVANT DE COLLER, remplacer 1 valeur :
--   __MEWS_POLL_SECRET__ → la valeur de MEWS_POLL_SECRET (cf. .env.local),
--      la même que celle déjà posée dans les variables d'env Netlify.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotence : retire un éventuel job précédent du même nom.
select cron.unschedule('mews-refresh-occupancy')
where exists (select 1 from cron.job where jobname = 'mews-refresh-occupancy');

select cron.schedule(
  'mews-refresh-occupancy',
  '7 */3 * * *',                          -- toutes les 3 h (à HH:07)
  $$
  select net.http_post(
    url     := 'https://magnificent-gumdrop-4b7f4f.netlify.app/api/mews/refresh-occupancy',
    headers := '{"Content-Type":"application/json","x-mews-poll-secret":"__MEWS_POLL_SECRET__"}'::jsonb,
    body    := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);

-- Vérif : SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'mews-refresh-occupancy';
-- Forcer un run immédiat (1er remplissage) : appeler la route à la main avec le
-- header x-mews-poll-secret, ou attendre le prochain top horaire.
-- Désactiver à tout moment : SELECT cron.unschedule('mews-refresh-occupancy');
