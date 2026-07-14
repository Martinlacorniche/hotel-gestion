-- 76_parfum_diffuseurs.sql
-- ============================================================================
-- Module Parfums d'ambiance — diffuseurs Aroma-Link (5 flacons), pilotés CLOUD.
-- ============================================================================
-- Le site (réception / dashboard) écrit une CONSIGNE ; l'`agent_parfum`
-- (service_role) la lit, l'applique via le cloud aroma-link.com, et remonte les
-- niveaux d'huile + l'état en ligne. Même patron que 69_agent_heartbeat.
--
-- Parfums = gamme Byca. Un thème peut occuper 2 flacons du même diffuseur
-- (ex. Figue en buses 1 & 2) : autonomie (bascule) ou boost (les deux à la fois).
-- Idempotent. À coller après 75. RLS : lecture authentifiée, écriture agent en
-- service_role (contourne RLS). Politiques hôtel à ajuster selon ta convention.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Catalogue des parfums — global (Corniche uniquement pour l'instant)
-- ----------------------------------------------------------------------------
create table if not exists public.parfums (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,                -- 'figue' | 'petitgrain' | 'thenoir'
  nom        text not null,                       -- 'Figue'
  emoji      text,                                -- '🌸'
  couleur    text,                                -- '#A9757F' (pastille UI)
  actif      boolean not null default true,
  ordre      int not null default 0,
  created_at timestamptz not null default now()
);

-- Pré-remplissage gamme Byca (idempotent).
insert into public.parfums (code, nom, emoji, couleur, ordre) values
  ('figue',      'Figue',       '🌸', '#A9757F', 1),
  ('petitgrain', 'Petit grain', '🍊', '#C4863B', 2),
  ('thenoir',    'Thé noir',    '🤍', '#524C43', 3)
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- 2) Diffuseurs : une machine Aroma-Link = une chambre.
--    L'agent AUTO-DÉCOUVRE les machines du compte cloud et les upsert par
--    `device_id` (unique global). Une machine fraîchement branchée arrive avec
--    room_unit_id = NULL = « découverte, à mapper » → le staff l'assigne à une
--    chambre dans le dashboard (flux pensé pour l'arrivée des 27 machines).
-- ----------------------------------------------------------------------------
create table if not exists public.diffuseurs (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid references public.hotels(id) on delete cascade,   -- NULL tant que non mappée
  room_unit_id uuid unique references public.room_units(id) on delete set null,  -- 1 machine / chambre
  device_id    text not null unique,              -- deviceId aroma-link ('438379')
  device_no    text,                              -- MAC / deviceNo ('18CEDFE2B4AC')
  nom          text,                              -- 'Smart.A5.WIFI'
  nb_buses     int not null default 5 check (nb_buses between 1 and 7),
  actif        boolean not null default true,
  en_ligne     boolean not null default false,    -- maj par l'agent (cloud)
  vu_at        timestamptz,                        -- dernier contact cloud
  created_at   timestamptz not null default now()
);
create index if not exists idx_diffuseurs_hotel on public.diffuseurs(hotel_id);
create index if not exists idx_diffuseurs_room  on public.diffuseurs(room_unit_id);
-- Machines découvertes mais pas encore assignées à une chambre (file de mapping).
create index if not exists idx_diffuseurs_a_mapper on public.diffuseurs(created_at) where room_unit_id is null;

-- ----------------------------------------------------------------------------
-- 3) Buses : quel parfum dans chaque flacon + niveau d'huile (maj par l'agent)
-- ----------------------------------------------------------------------------
create table if not exists public.diffuseur_buses (
  id            uuid primary key default gen_random_uuid(),
  diffuseur_id  uuid not null references public.diffuseurs(id) on delete cascade,
  buse_no       int not null check (buse_no between 1 and 7),
  parfum_id     uuid references public.parfums(id) on delete set null,
  role          text not null default 'principal'      -- 'principal' | 'reserve'
                 check (role in ('principal','reserve')),
  niveau_pct    int check (niveau_pct between 0 and 100),
  niveau_maj_at timestamptz,
  unique (diffuseur_id, buse_no)
);
create index if not exists idx_buses_parfum on public.diffuseur_buses(parfum_id);

-- ----------------------------------------------------------------------------
-- 4) Consignes : l'intention (réception / staff / client) que l'agent applique
-- ----------------------------------------------------------------------------
create table if not exists public.consignes_parfum (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid not null references public.hotels(id) on delete cascade,
  diffuseur_id uuid not null references public.diffuseurs(id) on delete cascade,
  parfum_id    uuid references public.parfums(id) on delete set null,   -- null si mode 'off'
  mode         text not null default 'ambiance'
                check (mode in ('ambiance','boost','off')),
  source       text not null default 'reception'
                check (source in ('reception','staff','client','auto')),
  cree_par     uuid,                               -- utilisateur (null si client)
  applique     boolean not null default false,     -- l'agent a-t-il exécuté ?
  applique_at  timestamptz,
  erreur       text,                               -- message si échec cloud
  created_at   timestamptz not null default now()
);
-- L'agent lit la dernière consigne par diffuseur, et la file des non-appliquées.
create index if not exists idx_consignes_diffuseur on public.consignes_parfum(diffuseur_id, created_at desc);
create index if not exists idx_consignes_todo on public.consignes_parfum(applique) where applique = false;

-- ----------------------------------------------------------------------------
-- 5) RLS — lecture authentifiée ; écriture agent via service_role (contourne RLS)
-- ----------------------------------------------------------------------------
alter table public.parfums          enable row level security;
alter table public.diffuseurs       enable row level security;
alter table public.diffuseur_buses  enable row level security;
alter table public.consignes_parfum enable row level security;

drop policy if exists parfums_read on public.parfums;
create policy parfums_read on public.parfums
  for select to authenticated using (true);

drop policy if exists diffuseurs_read on public.diffuseurs;
create policy diffuseurs_read on public.diffuseurs
  for select to authenticated using (true);

drop policy if exists diffuseur_buses_read on public.diffuseur_buses;
create policy diffuseur_buses_read on public.diffuseur_buses
  for select to authenticated using (true);

drop policy if exists consignes_parfum_read on public.consignes_parfum;
create policy consignes_parfum_read on public.consignes_parfum
  for select to authenticated using (true);

-- La réception (staff authentifié) crée des consignes ; l'agent les applique.
drop policy if exists consignes_parfum_insert on public.consignes_parfum;
create policy consignes_parfum_insert on public.consignes_parfum
  for insert to authenticated with check (true);
