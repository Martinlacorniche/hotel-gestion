-- ============================================================================
-- 43 — Purge automatique de l'historique des séjours (serrures) > 2 semaines
-- ============================================================================
-- Les séjours (table public.sejours) sont l'historique d'encodage des clefs
-- (codes / cartes). Aucune valeur légale à les conserver longtemps (≠ plannings
-- RH, soumis à conservation) et minimiser ces données est conforme RGPD.
--
-- On supprime chaque nuit les séjours TERMINÉS depuis plus de `retention_days`
-- jours (défaut 14), ainsi que leurs jobs d'encodage liés. On ne touche JAMAIS
-- aux séjours 'actif' ou 'pending'.
--
-- Effet de bord utile : empêche l'accumulation de séjours qui bloquait le
-- « démapper » d'une chambre (FK sejours.chambre_id sans cascade).
--
-- Mécanisme : fonction SQL + pg_cron (déjà utilisé, cf. 38/40). À jouer dans le
-- SQL Editor. Idempotent (create or replace + unschedule avant schedule).

create extension if not exists pg_cron;

-- ── Fonction de purge ───────────────────────────────────────────────────────
create or replace function public.purge_old_sejours(retention_days int default 14)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz := now() - make_interval(days => retention_days);
  deleted int;
begin
  -- Séjours candidats : terminés (fin dépassée) au-delà de la rétention,
  -- jamais en cours (actif/pending).
  create temp table _purge on commit drop as
    select id from public.sejours
    where fin < cutoff
      and statut not in ('actif', 'pending');

  -- Détache les éventuels survivants qui pointeraient vers un séjour purgé
  -- (self-FK parent_sejour_id des codes multi-chambres).
  update public.sejours s
     set parent_sejour_id = null
   where parent_sejour_id in (select id from _purge)
     and s.id not in (select id from _purge);

  -- Jobs d'encodage rattachés aux séjours purgés.
  delete from public.jobs_encodeur where sejour_id in (select id from _purge);

  -- Séjours eux-mêmes.
  delete from public.sejours where id in (select id from _purge);
  get diagnostics deleted = row_count;

  return deleted;
end;
$$;

-- ── Planification quotidienne (03h17 UTC, hors heures de pointe) ─────────────
select cron.unschedule('purge-old-sejours')
where exists (select 1 from cron.job where jobname = 'purge-old-sejours');

select cron.schedule(
  'purge-old-sejours',
  '17 3 * * *',
  $$ select public.purge_old_sejours(14); $$
);

-- Vérif :   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'purge-old-sejours';
-- Manuel :  SELECT public.purge_old_sejours(14);   -- renvoie le nb de séjours supprimés
-- Stop :    SELECT cron.unschedule('purge-old-sejours');
