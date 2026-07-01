-- Blacklist du Rooftop des Voiles : clients ayant posé un lapin (no-show).
-- Bloque la réservation EN LIGNE (le formulaire public renvoie « appelez-nous »).
-- Match sur l'email OU le nom (insensible à la casse / aux espaces).
-- À coller dans le SQL editor Supabase.

create table if not exists public.rooftop_blacklist (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  email       text,
  nom         text,
  motif       text,
  created_at  timestamptz default now(),
  constraint rooftop_blacklist_email_or_nom check (email is not null or nom is not null)
);

create index if not exists idx_rooftop_blacklist_hotel
  on public.rooftop_blacklist (hotel_id);

alter table public.rooftop_blacklist enable row level security;

-- Gestion réservée à l'équipe authentifiée. AUCUNE policy anon → la liste
-- (noms/emails) n'est jamais lisible publiquement.
drop policy if exists "rooftop_blacklist manage" on public.rooftop_blacklist;
create policy "rooftop_blacklist manage" on public.rooftop_blacklist
  for all to authenticated using (true) with check (true);

-- ── Vérification appelable en anon : renvoie UNIQUEMENT un booléen ────────────
-- SECURITY DEFINER → lit la table malgré la RLS, sans exposer les lignes.
create or replace function public.is_rooftop_blacklisted(p_hotel uuid, p_email text, p_nom text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.rooftop_blacklist b
    where b.hotel_id = p_hotel
      and (
        (b.email is not null and nullif(trim(p_email), '') is not null
          and lower(trim(b.email)) = lower(trim(p_email)))
        or
        (b.nom is not null and nullif(trim(p_nom), '') is not null
          and lower(trim(b.nom)) = lower(trim(p_nom)))
      )
  );
$$;

grant execute on function public.is_rooftop_blacklisted(uuid, text, text) to anon, authenticated;

-- ── Filet de sécurité : bloque l'INSERT d'une réservation blacklistée ─────────
-- (défense en profondeur : même un POST direct qui contourne le formulaire échoue.)
create or replace function public.rooftop_reservations_block_blacklisted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_rooftop_blacklisted(new.hotel_id, new.email, new.nom) then
    raise exception 'Réservation refusée (blacklist)' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_rooftop_resa_blacklist on public.rooftop_reservations;
create trigger trg_rooftop_resa_blacklist
  before insert on public.rooftop_reservations
  for each row execute function public.rooftop_reservations_block_blacklisted();
