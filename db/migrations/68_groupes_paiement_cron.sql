-- Cron « paiement programmé » des groupes : chaque matin, appelle la route
-- /api/groupes/paiement-programme qui (1) envoie les liens de paiement dus
-- (mode différé, date d'envoi atteinte) et (2) relâche les chambres impayées
-- après 48h. À coller dans le SQL editor Supabase (après 67_groupes_paiement_differe.sql).
--
-- ⚠️ AVANT DE COLLER : remplacer __CRON_SECRET__ par la valeur de CRON_SECRET
-- (ou MEWS_POLL_SECRET — la route accepte les deux en-têtes), et vérifier l'URL Netlify.
-- Idempotent : on désinscrit le job avant de le (re)planifier.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('groupes-paiement-programme')
where exists (select 1 from cron.job where jobname = 'groupes-paiement-programme');

-- 5h UTC ≈ 7h Paris. Une fois par jour (la relâche 48h a une granularité jour).
select cron.schedule(
  'groupes-paiement-programme',
  '0 5 * * *',
  $$
  select net.http_post(
    url     := 'https://magnificent-gumdrop-4b7f4f.netlify.app/api/groupes/paiement-programme',
    headers := '{"Content-Type":"application/json","x-cron-secret":"__CRON_SECRET__"}'::jsonb,
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
