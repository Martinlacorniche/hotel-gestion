-- POS Rooftop — TVA par ligne + facturation réglementaire.
-- Ajoute le type de TVA sur chaque ligne, les infos client + n° de facture sur
-- l'addition, et une séquence de numéro de facture SANS TROU (par hôtel/année).
-- À coller dans le SQL editor Supabase (après 62_hotels_identite_legale.sql).

-- ── Type de TVA par ligne de commande ────────────────────────────────────────
--   soft / food → 10% ; alcool → ventilation 50% à 10% + 50% à 20%.
alter table public.rooftop_order_items
  add column if not exists tva_type text
    check (tva_type in ('soft', 'alcool', 'food'));

-- ── Facturation sur l'addition ───────────────────────────────────────────────
alter table public.rooftop_orders
  add column if not exists numero       text,        -- n° facture séquentiel (émis à la facturation)
  add column if not exists facturee_at  timestamptz, -- horodatage émission facture
  add column if not exists client_nom   text,
  add column if not exists client_email text;

create unique index if not exists idx_rooftop_orders_numero
  on public.rooftop_orders (hotel_id, numero) where numero is not null;

-- ── Compteur de facture (séquence légale sans trou, par hôtel + année) ────────
create table if not exists public.facture_compteur (
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  annee       int  not null,
  dernier_num int  not null default 0,
  primary key (hotel_id, annee)
);

alter table public.facture_compteur enable row level security;
drop policy if exists "facture_compteur manage" on public.facture_compteur;
create policy "facture_compteur manage" on public.facture_compteur
  for all to authenticated using (true) with check (true);

-- Attribue atomiquement le prochain numéro pour (hôtel, année). Renvoie l'entier.
create or replace function public.next_facture_num(p_hotel uuid, p_annee int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_num int;
begin
  insert into public.facture_compteur (hotel_id, annee, dernier_num)
    values (p_hotel, p_annee, 1)
  on conflict (hotel_id, annee)
    do update set dernier_num = facture_compteur.dernier_num + 1
  returning dernier_num into v_num;
  return v_num;
end;
$$;
