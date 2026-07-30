-- Petit-déjeuner optionnel sur les réservations de groupe (demande Fabien, 2026-07-30).
--
-- Deux niveaux, parce que le prix ne se décide pas au même endroit que le choix :
--   · le TARIF est négocié par groupe ET par hôtel — un même mariage peut valoir
--     10 € aux Voiles et 15 € à La Corniche. D'où une table (groupe × hôtel), et
--     surtout pas une colonne sur `groupes` ni un réglage global d'établissement.
--   · le CHOIX est fait par l'invité, nuit par nuit : il peut prendre le petit-
--     déjeuner les deux premiers matins et pas le dernier.
--
-- Facturation : prix × personnes × nuits cochées.

-- ── Le tarif, par groupe et par hôtel ───────────────────────────────────────
create table if not exists public.groupe_pdj_tarifs (
  id         uuid primary key default gen_random_uuid(),
  groupe_id  uuid not null references public.groupes(id) on delete cascade,
  hotel_id   uuid not null references public.hotels(id),
  -- `actif` est distinct d'un prix à 0 : un mariage peut OFFRIR le petit-déjeuner
  -- (prix 0) tout en ayant besoin de savoir qui en prend, pour la mise en place.
  actif      boolean not null default true,
  prix       numeric(10,2) not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (groupe_id, hotel_id)
);

create index if not exists idx_groupe_pdj_tarifs_groupe
  on public.groupe_pdj_tarifs (groupe_id);

alter table public.groupe_pdj_tarifs enable row level security;

-- Lecture/écriture au back-office. La page publique passe par les routes
-- service_role de Site-BW, comme le reste du module.
drop policy if exists "groupe_pdj_tarifs manage" on public.groupe_pdj_tarifs;
create policy "groupe_pdj_tarifs manage" on public.groupe_pdj_tarifs
  for all to authenticated using (true) with check (true);

-- ── Le choix de l'invité, sur sa réservation ────────────────────────────────
-- Les nuits COCHÉES, pas un booléen : « la nuit du 25 » vaut le petit-déjeuner du
-- matin du 26. Même type que `groupe_chambres.nuits_exclues` (migration 86) pour
-- que les deux se manipulent pareil.
alter table public.groupe_reservations
  add column if not exists pdj_nuits date[] not null default '{}';

-- Prix FIGÉ au moment de la réservation. Sans lui, renégocier le tarif du groupe
-- réécrirait le montant de réservations déjà payées.
alter table public.groupe_reservations
  add column if not exists pdj_prix_unitaire numeric(10,2);

comment on column public.groupe_reservations.pdj_nuits is
  'Nuits pour lesquelles l''invité prend le petit-déjeuner (le PDJ de la nuit N se sert le matin N+1).';
comment on column public.groupe_reservations.pdj_prix_unitaire is
  'Tarif PDJ par personne et par nuit, figé à la réservation (le tarif du groupe peut bouger après).';
