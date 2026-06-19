-- ============================================================================
-- Module Groupes — Room block self-booking (mariages & groupes)
-- ============================================================================
-- L'hôtel crée un GROUPE (ex : "Mariage Léa & Tom"), alloue un bloc fermé de
-- chambres (X chambres d'un type, à tel tarif, pour telles dates) qui peut
-- s'étaler sur PLUSIEURS hôtels, et partage un lien public + code aux invités.
-- Les invités piochent dans le bloc, signent, et gèrent eux-mêmes leur résa.
--
-- Tables :
--   room_types          → config "en dur" des types de chambre, par hôtel
--   groupes             → l'événement (multi-hôtel : pas de hotel_id propre)
--   groupe_chambres     → l'allotement (porte hotel_id + room_type + tarif + qté)
--   groupe_reservations → les inscriptions des invités (magic link, signature)
--
-- L'accès invité (page publique sur Site-BW) passera par des API routes
-- service_role : ces tables restent donc en RLS "authenticated only".
-- Idempotent. À coller dans le SQL editor Supabase.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Types de chambre (config par hôtel, réutilisée par tous les groupes)
-- ----------------------------------------------------------------------------
create table if not exists public.room_types (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  nom         text not null,                       -- "Double Confort", "Suite", "Twin"
  pax_max     int  not null default 2 check (pax_max >= 1),
  twinable    boolean not null default false,      -- peut être configuré en 2 lits
  ordre       int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists idx_room_types_hotel
  on public.room_types(hotel_id, ordre);

-- ----------------------------------------------------------------------------
-- 2) Groupes (l'événement) — multi-hôtel, donc pas de hotel_id propre
-- ----------------------------------------------------------------------------
create table if not exists public.groupes (
  id                      uuid primary key default gen_random_uuid(),
  nom                     text not null,                   -- "Mariage Léa & Tom"
  code_acces              text not null unique,            -- code de la page publique
  date_arrivee            date not null,
  date_depart             date not null,
  date_limite             date not null,                   -- butoir d'inscription (release date)
  conditions_annulation   text,
  plan_visible            boolean not null default true,   -- invités voient qui a quelle chambre
  cover_image_url         text,                            -- personnalisation : photo de couverture
  message_accueil         text,                            -- mot d'accueil personnalisé
  contact_nom             text,                            -- organisateur (les mariés)
  contact_email           text,
  notes                   text,                            -- notes internes back-office
  statut                  text not null default 'actif',   -- actif | clos | annule
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists idx_groupes_code on public.groupes(code_acces);
create index if not exists idx_groupes_statut on public.groupes(statut, date_arrivee);

-- ----------------------------------------------------------------------------
-- 3) Allotement (lignes de bloc) — porte l'hôtel + le type + tarif + quantités
-- ----------------------------------------------------------------------------
create table if not exists public.groupe_chambres (
  id                  uuid primary key default gen_random_uuid(),
  groupe_id           uuid not null references public.groupes(id) on delete cascade,
  hotel_id            uuid not null references public.hotels(id) on delete cascade,
  room_type_id        uuid not null references public.room_types(id),
  tarif_nuit          numeric(10,2) not null check (tarif_nuit >= 0),
  quantite_allouee    int not null check (quantite_allouee >= 0),
  quantite_restante   int not null check (quantite_restante >= 0),  -- décrément atomique
  created_at          timestamptz not null default now()
);

create index if not exists idx_groupe_chambres_groupe on public.groupe_chambres(groupe_id);
create index if not exists idx_groupe_chambres_hotel  on public.groupe_chambres(hotel_id);

-- ----------------------------------------------------------------------------
-- 4) Réservations invités (alimentées par la page publique en Phase 2)
-- ----------------------------------------------------------------------------
create table if not exists public.groupe_reservations (
  id                  uuid primary key default gen_random_uuid(),
  groupe_id           uuid not null references public.groupes(id) on delete cascade,
  groupe_chambre_id   uuid not null references public.groupe_chambres(id),
  token               text not null unique,            -- magic link (lien perso invité)
  nom                 text not null,
  prenom              text,
  email               text not null,
  tel                 text,
  date_arrivee        date not null,
  date_depart         date not null,
  config_lit          text,                            -- 'double' | 'twin' (si twinable)
  nb_personnes        int not null default 1 check (nb_personnes >= 1),
  signature_url       text,                            -- image de signature (Storage)
  cgv_acceptees_at    timestamptz,                     -- horodatage acceptation CGV
  statut              text not null default 'confirmee', -- confirmee | annulee
  derniere_action     text not null default 'creation', -- creation | modification | annulation
  vu_backoffice       boolean not null default false,  -- pour le badge "modifs à traiter"
  created_at          timestamptz not null default now(),
  modified_at         timestamptz not null default now(),
  annulee_at          timestamptz
);

create index if not exists idx_groupe_resa_groupe on public.groupe_reservations(groupe_id);
create index if not exists idx_groupe_resa_chambre on public.groupe_reservations(groupe_chambre_id);
create index if not exists idx_groupe_resa_token on public.groupe_reservations(token);
create index if not exists idx_groupe_resa_avu on public.groupe_reservations(vu_backoffice) where vu_backoffice = false;
