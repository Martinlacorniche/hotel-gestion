-- Réservations de table du Rooftop des Voiles (formulaire public de la vitrine
-- Site-BW). Le formulaire poste en anon (INSERT), la notification part par email
-- (Resend) vers contact-lesvoiles@htbm.fr. Lecture réservée à l'équipe (authenticated).
-- À coller dans le SQL editor Supabase.

create table if not exists public.rooftop_reservations (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  date_resa   date not null,
  heure       text not null,
  couverts    int  not null default 2,
  nom         text not null,
  telephone   text,
  email       text,
  message     text,
  statut      text not null default 'nouvelle' check (statut in ('nouvelle', 'confirmee', 'annulee')),
  created_at  timestamptz default now()
);

create index if not exists idx_rooftop_reservations_hotel
  on public.rooftop_reservations (hotel_id, date_resa);

alter table public.rooftop_reservations enable row level security;

-- INSERT : ouvert à anon (formulaire public de la vitrine). Pas de SELECT anon
-- → un visiteur ne peut PAS lire les réservations des autres.
drop policy if exists "rooftop_reservations insert public" on public.rooftop_reservations;
create policy "rooftop_reservations insert public" on public.rooftop_reservations
  for insert to anon, authenticated with check (true);

-- Lecture + gestion (changer le statut) : équipe authentifiée uniquement.
drop policy if exists "rooftop_reservations read" on public.rooftop_reservations;
create policy "rooftop_reservations read" on public.rooftop_reservations
  for select to authenticated using (true);

drop policy if exists "rooftop_reservations manage" on public.rooftop_reservations;
create policy "rooftop_reservations manage" on public.rooftop_reservations
  for update to authenticated using (true) with check (true);
