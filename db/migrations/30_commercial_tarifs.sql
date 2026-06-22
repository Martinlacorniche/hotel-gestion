-- Offres & tarifs commerciaux éditables, par hôtel (remplace les tableaux en dur
-- de l'onglet « Offres & Tarifs » de /commercial).
-- À coller dans le SQL editor Supabase.

create table if not exists public.commercial_tarifs (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  section     text not null check (section in ('salle', 'resto')),
  categorie   text not null,                 -- 'Salles' | 'Menus à table' | 'Cocktails dinatoires' | 'Self service'
  nom         text not null default '',
  detail      text,
  prix        text,                          -- texte libre : « 239 € / 359 € », « Événementiel »…
  ordre       int  not null default 0,
  created_at  timestamptz default now()
);

create index if not exists idx_commercial_tarifs_hotel
  on public.commercial_tarifs (hotel_id, section, categorie, ordre);

alter table public.commercial_tarifs enable row level security;

-- Lecture : tout utilisateur authentifié.
drop policy if exists "commercial_tarifs read" on public.commercial_tarifs;
create policy "commercial_tarifs read" on public.commercial_tarifs
  for select to authenticated using (true);

-- Écriture : utilisateur authentifié (le verrou « admin » est appliqué côté UI,
-- comme pour room_types / room_units du module Groupes).
drop policy if exists "commercial_tarifs write" on public.commercial_tarifs;
create policy "commercial_tarifs write" on public.commercial_tarifs
  for all to authenticated using (true) with check (true);
