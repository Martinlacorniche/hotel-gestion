-- ============================================================================
-- Module Maintenance — Réseaux de climatisation
-- ============================================================================
-- Une ligne = 1 réseau = 1 groupe extérieur (moteur) reliant plusieurs clims.
--   rooms   : chambres/zones reliées à ce moteur (valeurs alignées sur les
--             ROOM_OPTIONS du module maintenance, ex: '17', '26', 'Seminaire')
--   tableau : emplacement du disjoncteur / tableau électrique (null = inconnu)
--   label   : nom libre optionnel ; si null, l'app titre le réseau par ses rooms
--
-- Source initiale : doc manuscrit "Pannes et groupement de climatiseurs"
-- La Corniche (scan 2026-05-29). Idempotent. À jouer dans Supabase SQL Editor,
-- puis db/security/12_clim_reseaux_rls.sql.
-- ============================================================================

create table if not exists public.clim_reseaux (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  label       text,
  rooms       text[] not null default '{}',
  tableau     text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists idx_clim_reseaux_hotel
  on public.clim_reseaux(hotel_id, sort_order);

-- ----------------------------------------------------------------------------
-- Seed La Corniche (idempotent : on n'insère pas un réseau si l'une de ses
-- chambres est déjà rattachée à un réseau de cet hôtel — opérateur && d'overlap)
-- ----------------------------------------------------------------------------
do $$
declare
  v_hotel_name constant text := 'La Corniche';   -- ⚠️ changer ici pour Les Voiles
  v_hotel_id   uuid;
begin
  select id into v_hotel_id
  from public.hotels
  where nom ilike v_hotel_name
  limit 1;

  if v_hotel_id is null then
    raise exception 'Hôtel introuvable : %', v_hotel_name;
  end if;

  raise notice 'Seed réseaux clim pour hôtel % (id=%)', v_hotel_name, v_hotel_id;

  insert into public.clim_reseaux (hotel_id, rooms, tableau, sort_order)
  select v_hotel_id, r.rooms, r.tableau, r.ord
  from (values
    (array['Seminaire']::text[],            'En salle séminaire'::text,         1),
    (array['2']::text[],                    'En bagagerie',                     2),
    (array['3','4','5']::text[],            'En bagagerie',                     3),
    (array['6','7']::text[],                'Placards réception',               4),
    (array['11','12','14','15']::text[],    null,                               5),
    (array['16','25','35']::text[],         null,                               6),
    (array['17','26','36']::text[],         null,                               7),
    (array['18','27','37']::text[],         'Entrée Nord',                      8),
    (array['21','32','23','24']::text[],    'Bout du couloir — 2e étage',       9),
    (array['31','22','33','34']::text[],    'Bout du couloir — 3e étage',       10),
    (array['41','42']::text[],              'WC de la 42',                      11)
  ) as r(rooms, tableau, ord)
  where not exists (
    select 1 from public.clim_reseaux c
    where c.hotel_id = v_hotel_id and c.rooms && r.rooms
  );
end $$;
