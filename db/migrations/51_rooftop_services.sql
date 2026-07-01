-- Rooftop — "services" (créneaux de rotation). Aujourd'hui un seul service (le soir),
-- mais on prépare la structure pour une future rotation (1er service / 2e service…).
-- Sert à alimenter les heures proposées à la réservation. À coller après 50.

create table if not exists public.rooftop_services (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  nom         text not null,               -- ex. « Service du soir », « 1er service »
  heure       text,                        -- heure indicative (ex. « 19h30 »)
  actif       boolean not null default true,
  ordre       int  not null default 0,
  created_at  timestamptz default now()
);

create index if not exists idx_rooftop_services_hotel
  on public.rooftop_services (hotel_id, ordre);

alter table public.rooftop_services enable row level security;

-- Lecture publique (le parcours de résa propose les heures de service), gestion équipe.
drop policy if exists "rooftop_services read" on public.rooftop_services;
create policy "rooftop_services read" on public.rooftop_services
  for select to anon, authenticated using (true);
drop policy if exists "rooftop_services manage" on public.rooftop_services;
create policy "rooftop_services manage" on public.rooftop_services
  for all to authenticated using (true) with check (true);

-- Service par défaut (Les Voiles) — éditable dans le module Rooftop.
insert into public.rooftop_services (hotel_id, nom, heure, ordre)
values ('ded6e6fb-ff3c-4fa8-ad07-403ee316be53', 'Service du soir', '19h30', 0)
on conflict do nothing;
