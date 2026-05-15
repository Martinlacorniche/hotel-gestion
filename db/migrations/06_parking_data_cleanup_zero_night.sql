-- ============================================================================
-- NETTOYAGE COMPLET — Réservations parking « end_date = start_date »
-- ============================================================================
-- Stratégie en 4 étapes appliquées d'affilée (pas de transaction, chaque
-- action s'applique immédiatement) :
--
--   Étape 1 : SUPPRIMER toutes les résa zero-night PASSÉES
--             (historique sans impact opérationnel — décision métier)
--
--   Étape 2 : SUPPRIMER les doublons stricts parmi les zero-night FUTURES
--             (même place + même date = erreur de saisie)
--
--   Étape 3 : CONVERTIR end = start + 1 pour les zero-night FUTURES restantes
--             (mais SEULEMENT si aucune autre résa ne crée un conflit le
--             lendemain — sinon on les laisse pour traitement manuel)
--
--   Étape 4 : LISTER les zero-night FUTURES qui restent → à corriger à la
--             main dans Supabase Table Editor avant de jouer la migration 06.
--
-- À jouer dans Supabase SQL Editor en une seule fois.
-- ============================================================================

-- ÉTAPE 1 — Suppression des zero-night passées
delete from public.parking_reservations
where start_date = end_date
  and start_date < current_date;

-- ÉTAPE 2 — Suppression des doublons stricts (futures)
with futures_zero_night as (
  select id,
         row_number() over (partition by parking_id, start_date order by id) as rn
  from public.parking_reservations
  where start_date = end_date
    and start_date >= current_date
)
delete from public.parking_reservations
where id in (select id from futures_zero_night where rn > 1);

-- ÉTAPE 3 — Conversion end = start + 1 quand pas de conflit
update public.parking_reservations z
set end_date = z.start_date + interval '1 day'
where z.start_date = z.end_date
  and z.start_date >= current_date
  and not exists (
    select 1 from public.parking_reservations c
    where c.parking_id = z.parking_id
      and c.id <> z.id
      and c.start_date <= z.start_date + interval '1 day'
      and c.end_date   >  z.start_date + interval '1 day'
  );

-- ÉTAPE 4 — Liste les zero-night restantes (à corriger à la main)
select
  z.id,
  z.client_name as client_zero,
  z.parking_id,
  z.start_date,
  c.id as id_resa_conflit,
  c.client_name as client_conflit,
  c.start_date as conflit_start,
  c.end_date as conflit_end,
  case
    when upper(trim(z.client_name)) = upper(trim(c.client_name)) then '👥 même client (probable continuation)'
    else '⚔ clients différents'
  end as scenario
from public.parking_reservations z
left join public.parking_reservations c
  on c.parking_id = z.parking_id
 and c.id <> z.id
 and c.start_date <= z.start_date + interval '1 day'
 and c.end_date   >  z.start_date + interval '1 day'
where z.start_date = z.end_date
order by z.start_date;

-- Compteur final
select count(*) as nb_zero_night_a_corriger_manuellement
from public.parking_reservations
where start_date = end_date;
