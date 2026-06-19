-- ============================================================================
-- Module Groupes — Table dédiée `room_units` (au lieu de réutiliser `chambres`)
-- ============================================================================
-- La table `chambres` appartient au module SERRURES : elle impose
-- tthotel_lock_id NOT NULL (= chambres équipées d'une serrure uniquement).
-- Ce n'est donc PAS une liste générale de chambres → on crée une table dédiée
-- `room_units` pour le catalogue de chambres du module Groupes, et on annule
-- les colonnes ajoutées à `chambres` par la migration 24.
--
-- groupe_chambres référence désormais room_units. Tables d'allotement recréées
-- (données de test, vides). Idempotent. À coller après 24. RLS : script 20.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Annuler l'extension de `chambres` (serrures) faite en migration 24
-- ----------------------------------------------------------------------------
alter table public.chambres drop column if exists room_type_id;
alter table public.chambres drop column if exists pax_max;
alter table public.chambres drop column if exists twinable;
alter table public.chambres drop column if exists active;

-- ----------------------------------------------------------------------------
-- 2) Catalogue de chambres du module Groupes (par hôtel, rattachées à un type)
-- ----------------------------------------------------------------------------
create table if not exists public.room_units (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references public.hotels(id) on delete cascade,
  room_type_id  uuid references public.room_types(id) on delete set null,
  numero        text not null,                       -- "12", "Suite Vue Mer"
  pax_max       int  not null default 2 check (pax_max >= 1),
  twinable      boolean not null default false,      -- configurable en 2 lits
  ordre         int  not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (hotel_id, numero)
);

create index if not exists idx_room_units_hotel on public.room_units(hotel_id, ordre);

-- ----------------------------------------------------------------------------
-- 3) Allotement : une chambre précise (room_units) dans le bloc + son tarif
-- ----------------------------------------------------------------------------
drop table if exists public.groupe_reservations cascade;
drop table if exists public.groupe_chambres cascade;

create table public.groupe_chambres (
  id          uuid primary key default gen_random_uuid(),
  groupe_id   uuid not null references public.groupes(id) on delete cascade,
  chambre_id  uuid not null references public.room_units(id),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  tarif_nuit  numeric(10,2) not null check (tarif_nuit >= 0),
  created_at  timestamptz not null default now(),
  unique (groupe_id, chambre_id)
);

create index if not exists idx_groupe_chambres_groupe on public.groupe_chambres(groupe_id);
create index if not exists idx_groupe_chambres_hotel  on public.groupe_chambres(hotel_id);

-- ----------------------------------------------------------------------------
-- 4) Réservations invités (alimentées par la page publique en Phase 2)
-- ----------------------------------------------------------------------------
create table public.groupe_reservations (
  id                  uuid primary key default gen_random_uuid(),
  groupe_id           uuid not null references public.groupes(id) on delete cascade,
  groupe_chambre_id   uuid not null references public.groupe_chambres(id) on delete cascade,
  token               text not null unique,
  nom                 text not null,
  prenom              text,
  email               text not null,
  tel                 text,
  date_arrivee        date not null,
  date_depart         date not null,
  config_lit          text,
  nb_personnes        int not null default 1 check (nb_personnes >= 1),
  signature_url       text,
  cgv_acceptees_at    timestamptz,
  statut              text not null default 'confirmee',
  derniere_action     text not null default 'creation',
  vu_backoffice       boolean not null default false,
  created_at          timestamptz not null default now(),
  modified_at         timestamptz not null default now(),
  annulee_at          timestamptz
);

create index if not exists idx_groupe_resa_groupe  on public.groupe_reservations(groupe_id);
create index if not exists idx_groupe_resa_chambre on public.groupe_reservations(groupe_chambre_id);
create index if not exists idx_groupe_resa_token   on public.groupe_reservations(token);
create index if not exists idx_groupe_resa_avu     on public.groupe_reservations(vu_backoffice) where vu_backoffice = false;

create unique index if not exists uq_resa_chambre_active
  on public.groupe_reservations(groupe_chambre_id) where statut = 'confirmee';
