-- Module Rooftop — inventaire des tables disponibles (Les Voiles).
-- Sert à paramétrer les tables du rooftop (nom/numéro + nb de couverts + actif).
-- À coller dans le SQL editor Supabase.

create table if not exists public.rooftop_tables (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  nom         text not null,                 -- ex. « T1 », « Table 4 », « Lounge »
  couverts    int  not null default 2,       -- capacité en personnes
  actif       boolean not null default true,
  ordre       int  not null default 0,
  created_at  timestamptz default now()
);

create index if not exists idx_rooftop_tables_hotel
  on public.rooftop_tables (hotel_id, ordre);

alter table public.rooftop_tables enable row level security;

-- Gestion réservée à l'équipe authentifiée (inventaire interne, pas d'accès anon).
drop policy if exists "rooftop_tables manage" on public.rooftop_tables;
create policy "rooftop_tables manage" on public.rooftop_tables
  for all to authenticated using (true) with check (true);
