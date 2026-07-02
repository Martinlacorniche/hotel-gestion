-- Cron d'échéance « Groupes & mariages » : chaque matin, appelle la route
-- /api/groupes/relance-limite qui prévient les équipes des blocs dont la date
-- limite d'inscription est atteinte (relâcher l'option dans le PMS).
--
-- ⚠️ AVANT DE COLLER dans le SQL editor Supabase :
--   1. Remplacer __CRON_SECRET__ par la valeur de CRON_SECRET (ou, si tu réutilises
--      l'existant, par MEWS_POLL_SECRET — la route accepte les deux en-têtes).
--   2. Vérifier l'URL Netlify (sous-domaine permanent, comme les crons Mews).
-- Idempotent : on désinscrit le job avant de le (re)planifier.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('groupes-relance-limite')
where exists (select 1 from cron.job where jobname = 'groupes-relance-limite');

-- 6h UTC ≈ 8h Paris (été). Une fois par jour suffit (anti-doublon côté route).
select cron.schedule(
  'groupes-relance-limite',
  '0 6 * * *',
  $$
  select net.http_post(
    url     := 'https://magnificent-gumdrop-4b7f4f.netlify.app/api/groupes/relance-limite',
    headers := '{"Content-Type":"application/json","x-cron-secret":"__CRON_SECRET__"}'::jsonb,
    body    := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
