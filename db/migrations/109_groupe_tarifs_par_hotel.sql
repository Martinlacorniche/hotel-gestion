-- La taxe de séjour rejoint le petit-déjeuner : un montant PAR HÔTEL du bloc.
--
-- Boulette repérée par Martin le 2026-07-30 : `groupes.taxe_sejour_montant` est
-- une valeur UNIQUE par groupe, alors que trois mariages (Julie & Théo, Maria &
-- Fabien, Mathilde & Henry) sont à cheval sur les deux établissements. Tous
-- portaient 2,83 € — le tarif de La Corniche — donc les invités logés aux Voiles
-- auraient payé 0,97 €/personne/nuit de trop. Aucun dégât : zéro réservation en
-- base au moment du correctif.
--
-- La table du petit-déjeuner (migration 108, non encore déployée) devient donc la
-- table des montants d'un groupe dans un hôtel — d'où le renommage.

alter table if exists public.groupe_pdj_tarifs rename to groupe_tarifs_hotel;
alter table if exists public.groupe_tarifs_hotel rename column actif to pdj_actif;
alter table if exists public.groupe_tarifs_hotel rename column prix  to pdj_prix;

-- NULL = « rien de spécifique pour cet hôtel » → on retombe sur
-- `groupes.taxe_sejour_montant`. Le mode (incluse / ajoutée) reste au niveau du
-- groupe : c'est une décision commerciale, pas un tarif d'établissement.
alter table public.groupe_tarifs_hotel
  add column if not exists taxe_sejour_montant numeric(10,2);

comment on table public.groupe_tarifs_hotel is
  'Montants d''un groupe pour UN hôtel : petit-déjeuner et taxe de séjour. Un groupe bi-hôtel a une ligne par établissement.';

-- ── Rattrapage des groupes existants ────────────────────────────────────────
-- Une ligne par (groupe, hôtel réellement dans le bloc), avec la taxe du groupe…
insert into public.groupe_tarifs_hotel (groupe_id, hotel_id, pdj_actif, pdj_prix, taxe_sejour_montant)
select distinct gc.groupe_id, gc.hotel_id, false, 0, g.taxe_sejour_montant
from public.groupe_chambres gc
join public.groupes g on g.id = gc.groupe_id
on conflict (groupe_id, hotel_id) do nothing;

-- …puis la correction : aux Voiles la taxe de séjour est de 1,86 €, pas 2,83 €.
update public.groupe_tarifs_hotel
set taxe_sejour_montant = 1.86, updated_at = now()
where hotel_id = 'ded6e6fb-ff3c-4fa8-ad07-403ee316be53'
  and taxe_sejour_montant is distinct from 1.86;
