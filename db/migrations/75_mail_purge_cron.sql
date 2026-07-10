-- Cron « purge de stockage » : tous les 3 jours, appelle la route
-- /api/mail-assistant/purge-junk qui supprime DÉFINITIVEMENT, sur les DEUX boîtes
-- (contact-lesvoiles@ et contact-corniche@) :
--   · le Courrier indésirable reçu il y a plus de 3 jours
--   · les Éléments supprimés (corbeille) reçus il y a plus de 7 jours
--
-- « On ne lit pas les indésirables, mais on vide la boîte tous les 3 jours, pensons
--   à la planète » + « mails supprimés, faut pas laisser traîner » (Martin 2026-07-10).
--
-- La route ne lit aucun contenu (id + date seulement) et ne touche jamais la boîte
-- de réception. Les délais laissent une fenêtre de repêchage si Outlook a classé un
-- vrai client en indésirable, ou si une suppression humaine était une erreur.
--
-- ⚠️ AVANT DE COLLER : remplacer __CRON_SECRET__ par la valeur de CRON_SECRET
-- (ou MEWS_POLL_SECRET — la route accepte les deux en-têtes), et vérifier l'URL Netlify.
-- Idempotent : on désinscrit le job avant de le (re)planifier.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('mail-purge-junk')
where exists (select 1 from cron.job where jobname = 'mail-purge-junk');

-- 4h UTC ≈ 6h Paris, tous les 3 jours (1er, 4e, 7e… du mois). Sans hôtel en query
-- string, la route purge les deux boîtes en série.
select cron.schedule(
  'mail-purge-junk',
  '0 4 */3 * *',
  $$
  select net.http_post(
    url     := 'https://magnificent-gumdrop-4b7f4f.netlify.app/api/mail-assistant/purge-junk',
    headers := '{"Content-Type":"application/json","x-cron-secret":"__CRON_SECRET__"}'::jsonb,
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
