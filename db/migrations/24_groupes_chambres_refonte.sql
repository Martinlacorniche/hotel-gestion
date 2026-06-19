-- ============================================================================
-- Module Groupes — Refonte : chambres physiques + allotement par chambre précise
-- ============================================================================
-- Évolution du modèle de la migration 23 :
--   - les chambres deviennent des entités PHYSIQUES (n°, type, pax, twinable)
--   - room_types n'est plus qu'un LIBELLÉ (pax_max/twinable déplacés sur chambres)
--   - l'allotement (groupe_chambres) référence une CHAMBRE PRÉCISE + un tarif
--     (plus de quantité), une chambre ne pouvant être qu'une fois dans un bloc
--   - anti double-réservation : index unique sur les réservations confirmées
--
-- groupe_chambres / groupe_reservations sont recréées (données de test, vides).
-- Idempotent. À coller dans le SQL editor Supabase (après 23). RLS : script 19.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) room_types : pax_max & twinable déménagent vers les chambres
-- ----------------------------------------------------------------------------
alter table public.room_types drop column if exists pax_max;
alter table public.room_types drop column if exists twinable;

-- ----------------------------------------------------------------------------
-- 2) Chambres physiques — RÉUTILISE la table `chambres` existante (système
--    serrures : id, hotel_id, numero, ordre, tthotel_lock_id…). On NE la recrée
--    PAS (sinon doublon de la liste des chambres). On y AJOUTE nos attributs.
-- ----------------------------------------------------------------------------
alter table public.chambres add column if not exists room_type_id uuid references public.room_types(id) on delete set null;
alter table public.chambres add column if not exists pax_max  int     not null default 2;
alter table public.chambres add column if not exists twinable boolean not null default false;
alter table public.chambres add column if not exists active   boolean not null default true;

-- ----------------------------------------------------------------------------
-- 3) Allotement : une chambre précise dans le bloc + son tarif
-- ----------------------------------------------------------------------------
drop table if exists public.groupe_reservations cascade;
drop table if exists public.groupe_chambres cascade;

create table public.groupe_chambres (
  id          uuid primary key default gen_random_uuid(),
  groupe_id   uuid not null references public.groupes(id) on delete cascade,
  chambre_id  uuid not null references public.chambres(id),
  hotel_id    uuid not null references public.hotels(id) on delete cascade, -- dénormalisé (filtre)
  tarif_nuit  numeric(10,2) not null check (tarif_nuit >= 0),
  created_at  timestamptz not null default now(),
  unique (groupe_id, chambre_id)                     -- une chambre une seule fois par groupe
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
  token               text not null unique,            -- magic link (lien perso invité)
  nom                 text not null,
  prenom              text,
  email               text not null,
  tel                 text,
  date_arrivee        date not null,
  date_depart         date not null,
  config_lit          text,                            -- 'double' | 'twin' (si twinable)
  nb_personnes        int not null default 1 check (nb_personnes >= 1),
  signature_url       text,
  cgv_acceptees_at    timestamptz,
  statut              text not null default 'confirmee', -- confirmee | annulee
  derniere_action     text not null default 'creation',  -- creation | modification | annulation
  vu_backoffice       boolean not null default false,
  created_at          timestamptz not null default now(),
  modified_at         timestamptz not null default now(),
  annulee_at          timestamptz
);

create index if not exists idx_groupe_resa_groupe  on public.groupe_reservations(groupe_id);
create index if not exists idx_groupe_resa_chambre on public.groupe_reservations(groupe_chambre_id);
create index if not exists idx_groupe_resa_token   on public.groupe_reservations(token);
create index if not exists idx_groupe_resa_avu     on public.groupe_reservations(vu_backoffice) where vu_backoffice = false;

-- Anti double-réservation : une seule résa CONFIRMÉE par chambre de bloc
create unique index if not exists uq_resa_chambre_active
  on public.groupe_reservations(groupe_chambre_id) where statut = 'confirmee';
