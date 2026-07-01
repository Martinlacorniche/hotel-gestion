-- Module Rooftop — capacité & fermetures des réservations (Les Voiles).
--   • rooftop_config   : limites par jour (couverts ET nb de réservations)
--   • rooftop_closures : jours où la vente en ligne est fermée
--   • rooftop_can_book(): verdict 'ok' | 'closed' | 'full' (appelable en anon)
--   • trigger de sécurité : bloque tout INSERT qui viole fermeture/limites
-- À coller dans le SQL editor Supabase (après 46_rooftop_reservations).

-- ── Config (une ligne par hôtel) ─────────────────────────────────────────────
create table if not exists public.rooftop_config (
  hotel_id           uuid primary key references public.hotels(id) on delete cascade,
  max_couverts_jour  int,   -- null = illimité
  max_resa_jour      int,   -- null = illimité
  updated_at         timestamptz default now()
);

alter table public.rooftop_config enable row level security;
drop policy if exists "rooftop_config read" on public.rooftop_config;
create policy "rooftop_config read" on public.rooftop_config
  for select to anon, authenticated using (true);
drop policy if exists "rooftop_config manage" on public.rooftop_config;
create policy "rooftop_config manage" on public.rooftop_config
  for all to authenticated using (true) with check (true);

-- Valeurs de départ pour Les Voiles (éditables dans le module Rooftop).
insert into public.rooftop_config (hotel_id, max_couverts_jour, max_resa_jour)
values ('ded6e6fb-ff3c-4fa8-ad07-403ee316be53', 40, 15)
on conflict (hotel_id) do nothing;

-- ── Jours fermés ─────────────────────────────────────────────────────────────
create table if not exists public.rooftop_closures (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  date_fermee date not null,
  motif       text,
  created_at  timestamptz default now(),
  unique (hotel_id, date_fermee)
);

create index if not exists idx_rooftop_closures_hotel
  on public.rooftop_closures (hotel_id, date_fermee);

alter table public.rooftop_closures enable row level security;
-- Lecture publique : la vitrine peut griser les jours fermés. Écriture équipe.
drop policy if exists "rooftop_closures read" on public.rooftop_closures;
create policy "rooftop_closures read" on public.rooftop_closures
  for select to anon, authenticated using (true);
drop policy if exists "rooftop_closures manage" on public.rooftop_closures;
create policy "rooftop_closures manage" on public.rooftop_closures
  for all to authenticated using (true) with check (true);

-- ── Verdict de disponibilité (anon) ──────────────────────────────────────────
-- SECURITY DEFINER : compte les réservations malgré la RLS, sans les exposer.
create or replace function public.rooftop_can_book(p_hotel uuid, p_date date, p_couverts int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_c int; v_max_r int;
  v_used_c int; v_used_r int;
begin
  if exists (select 1 from public.rooftop_closures where hotel_id = p_hotel and date_fermee = p_date) then
    return 'closed';
  end if;

  select max_couverts_jour, max_resa_jour into v_max_c, v_max_r
    from public.rooftop_config where hotel_id = p_hotel;

  select coalesce(sum(couverts), 0), count(*) into v_used_c, v_used_r
    from public.rooftop_reservations
    where hotel_id = p_hotel and date_resa = p_date and statut <> 'annulee';

  if v_max_c is not null and v_used_c + coalesce(p_couverts, 0) > v_max_c then return 'full'; end if;
  if v_max_r is not null and v_used_r + 1 > v_max_r then return 'full'; end if;
  return 'ok';
end;
$$;

grant execute on function public.rooftop_can_book(uuid, date, int) to anon, authenticated;

-- ── Filet de sécurité : bloque l'INSERT si fermé ou complet ──────────────────
create or replace function public.rooftop_reservations_check_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.rooftop_can_book(new.hotel_id, new.date_resa, new.couverts) <> 'ok' then
    raise exception 'Réservation indisponible pour cette date (fermé ou complet)' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_rooftop_resa_capacity on public.rooftop_reservations;
create trigger trg_rooftop_resa_capacity
  before insert on public.rooftop_reservations
  for each row execute function public.rooftop_reservations_check_capacity();
