-- ============================================================================
-- 82 — Groupes : deux modes de lecture + réservations non chevauchantes
-- ----------------------------------------------------------------------------
-- POURQUOI (Martin 2026-07-16, dossier CACTUS FILMS) :
-- La page publique d'un groupe n'a PAS de sélecteur de dates : tout le monde
-- réserve sur les dates du groupe. Pour un mariage (2 nuits, tout le monde
-- ensemble) c'est parfait. Pour un TOURNAGE de 11 nuits où chaque comédien
-- arrive et repart quand il veut (CACTUS : « départs les 28 ET 29 »), c'est
-- ingérable.
--
-- Décision : garder la jolie page actuelle ET offrir une vue « pro » (calendrier
-- chambres × nuits), le mode étant choisi PAR GROUPE dans le back-office —
-- comme `plan_visible`. Un seul point d'entrée public, deux rendus.
--
-- Ce que ce script fait :
--   1) `groupes.mode_vue` = 'simple' | 'pro'  (défaut 'simple' → rien ne bouge
--      pour les groupes existants).
--   2) LE VRAI VERROU : `uq_resa_chambre_active` impose UNE SEULE résa active
--      par chambre, quelles que soient les dates → une chambre prise du 18 au 28
--      est morte pour la nuit du 28 au 29. On le remplace par une contrainte
--      d'EXCLUSION qui interdit seulement les résas qui SE CHEVAUCHENT.
--
-- Le `'[)'` (borne d'arrivée incluse, départ exclu) porte la sémantique
-- hôtelière : le jour du départ libère la chambre pour l'arrivant du jour même.
--
-- ⚠️ La contrainte protège LES DEUX modes : en mode 'simple' tout le monde
-- réserve la plage entière du groupe, donc deux résas sur la même chambre se
-- chevauchent toujours → le comportement d'avant est conservé à l'identique.
-- La garantie vit en BASE, pas dans le front : aucune UI ne peut la contourner.
-- ============================================================================

-- 1) Mode de lecture de la page publique ------------------------------------
alter table public.groupes
  add column if not exists mode_vue text not null default 'simple';

alter table public.groupes
  drop constraint if exists groupes_mode_vue_check;
alter table public.groupes
  add constraint groupes_mode_vue_check check (mode_vue in ('simple', 'pro'));

comment on column public.groupes.mode_vue is
  'Rendu de la page publique : simple = cartes de chambres sur les dates du groupe (mariages) ; pro = calendrier chambres × nuits, chaque invité pose ses propres dates (tournages, séminaires, groupes longs).';

-- 2) Anti-chevauchement ------------------------------------------------------
-- btree_gist : indispensable pour mélanger une égalité (uuid) et un && (range)
-- dans une même contrainte d'exclusion.
create extension if not exists btree_gist;

-- L'ancien garde-fou « 1 résa par chambre » (migrations 24 → 34 → 67).
drop index if exists uq_resa_chambre_active;

alter table public.groupe_reservations
  drop constraint if exists ex_resa_chambre_no_overlap;

-- Deux résas ACTIVES sur la même chambre ne peuvent plus se chevaucher.
-- Les statuts retenus reprennent exactement ceux de l'index remplacé (67) :
-- une chambre TENUE en attente de paiement bloque déjà les autres.
alter table public.groupe_reservations
  add constraint ex_resa_chambre_no_overlap
  exclude using gist (
    groupe_chambre_id with =,
    daterange(date_arrivee, date_depart, '[)') with &&
  )
  where (statut in ('confirmee', 'en_attente_paiement', 'paiement_differe'));

comment on constraint ex_resa_chambre_no_overlap on public.groupe_reservations is
  'Remplace uq_resa_chambre_active (1 résa/chambre) : autorise des séjours SUCCESSIFS sur une même chambre, interdit les chevauchements. Borne [) → le jour du départ libère la chambre.';

-- Cohérence des dates : une résa dure au moins une nuit. La route API le
-- vérifiait déjà (« Dates hors des bornes du séjour ») ; on le garantit en base.
alter table public.groupe_reservations
  drop constraint if exists groupe_resa_dates_check;
alter table public.groupe_reservations
  add constraint groupe_resa_dates_check check (date_depart > date_arrivee);
