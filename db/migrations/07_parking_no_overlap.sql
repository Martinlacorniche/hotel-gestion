-- ============================================================================
-- Module Parking — Empêcher les chevauchements de réservations
-- ============================================================================
-- Garantie au niveau base : impossible d'avoir 2 réservations qui se chevauchent
-- sur la même place (parking_id), quelle que soit la source (web, mobile, API
-- directe, race condition entre 2 réceptionnistes simultanés).
--
-- Sémantique : daterange '[)' (semi-ouvert) → end_date est le jour de DÉPART
-- (libre dès le matin). Convention hôtelière standard : une résa 10→12 occupe
-- les jours 10 et 11, la place est libre le 12 → une nouvelle résa peut
-- commencer le 12 le même jour sans conflit.
--
-- Idempotent. À jouer dans Supabase SQL Editor.
-- ============================================================================

-- 1) Extension nécessaire pour combiner = et && dans une seule contrainte EXCLUDE
create extension if not exists btree_gist;

-- 2) Contrainte d'exclusion : pas 2 résas sur la même place dont les dateranges
--    se chevauchent (overlap operator &&).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'parking_reservations_no_overlap'
      and conrelid = 'public.parking_reservations'::regclass
  ) then
    alter table public.parking_reservations
      add constraint parking_reservations_no_overlap
      exclude using gist (
        parking_id with =,
        daterange(start_date, end_date, '[)') with &&
      );
  end if;
end $$;

-- 3) Vérification finale
select
  conname as contrainte,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.parking_reservations'::regclass
  and conname = 'parking_reservations_no_overlap';
