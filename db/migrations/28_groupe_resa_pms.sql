-- ============================================================================
-- Module Groupes — Suivi PMS des réservations
-- ============================================================================
-- `pms_done` : l'hôtel coche quand la réservation a été saisie (ou retirée, en
-- cas d'annulation) dans le PMS. Se RE-décoche automatiquement si l'invité
-- modifie ou annule (côté API : pms_done=false + vu_backoffice=false), pour
-- signaler qu'il faut re-traiter. Une annulation reste donc « à traiter » tant
-- que l'hôtel n'a pas confirmé l'avoir retirée du PMS.
-- Idempotent. À coller dans le SQL editor Supabase.
-- ============================================================================

alter table public.groupe_reservations add column if not exists pms_done boolean not null default false;
