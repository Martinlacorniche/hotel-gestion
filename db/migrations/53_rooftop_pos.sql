-- Rooftop — POS (point de vente) du service, Les Voiles. COQUILLE :
--   • rooftop_orders       : une addition = une table ouverte pendant le service
--   • rooftop_order_items  : les lignes de commande (plats + boissons)
-- L'encaissement enregistre la MÉTHODE choisie (TPE externe / espèce / transfert
-- chambre) — aucun débit réel ici (pas de Stripe), et le transfert chambre note
-- juste le n° de chambre en attendant l'ouverture du scope d'écriture Mews.
-- À coller dans le SQL editor Supabase (après 52_rooftop_presence.sql).

-- ── Additions ────────────────────────────────────────────────────────────────
create table if not exists public.rooftop_orders (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references public.hotels(id) on delete cascade,
  date_service   date not null,
  table_id       uuid references public.rooftop_tables(id) on delete set null,
  reservation_id uuid references public.rooftop_reservations(id) on delete set null,
  couvert_nom    text,                                   -- nom client (snapshot)
  statut         text not null default 'ouverte'
                   check (statut in ('ouverte', 'encaissee', 'annulee')),
  total          numeric(10,2) not null default 0,
  payment_method text check (payment_method in ('tpe', 'espece', 'chambre')),
  room_ref       text,                                   -- n° chambre si transfert
  created_at     timestamptz default now(),
  closed_at      timestamptz
);

create index if not exists idx_rooftop_orders_hotel_date
  on public.rooftop_orders (hotel_id, date_service, statut);

alter table public.rooftop_orders enable row level security;
-- Interne : équipe authentifiée uniquement (aucun accès anon).
drop policy if exists "rooftop_orders manage" on public.rooftop_orders;
create policy "rooftop_orders manage" on public.rooftop_orders
  for all to authenticated using (true) with check (true);

-- ── Lignes de commande ───────────────────────────────────────────────────────
create table if not exists public.rooftop_order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.rooftop_orders(id) on delete cascade,
  source      text not null check (source in ('plat', 'boisson')),
  ref_id      uuid,                                      -- id source (plat/boisson), nullable
  nom         text not null,
  prix        numeric(10,2) not null default 0,          -- prix unitaire capturé
  qty         int not null default 1,
  created_at  timestamptz default now()
);

create index if not exists idx_rooftop_order_items_order
  on public.rooftop_order_items (order_id);

alter table public.rooftop_order_items enable row level security;
drop policy if exists "rooftop_order_items manage" on public.rooftop_order_items;
create policy "rooftop_order_items manage" on public.rooftop_order_items
  for all to authenticated using (true) with check (true);
