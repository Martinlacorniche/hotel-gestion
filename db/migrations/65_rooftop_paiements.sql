-- POS Rooftop — paiements multiples par addition (règlement partiel / split).
-- Une addition peut être soldée en plusieurs fois et par plusieurs moyens
-- (ex. 20€ carte + le reste espèces). L'addition passe « encaissee » quand la
-- somme des paiements atteint son total. Coquille : aucun débit réel.
-- À coller dans le SQL editor Supabase (après 64_rooftop_closures_periodes.sql).

create table if not exists public.rooftop_order_payments (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.rooftop_orders(id) on delete cascade,
  hotel_id     uuid not null references public.hotels(id) on delete cascade,
  date_service date not null,
  method       text not null check (method in ('tpe', 'espece', 'chambre')),
  amount       numeric(10,2) not null,
  room_ref     text,                                   -- n° chambre si transfert
  created_at   timestamptz default now()
);

create index if not exists idx_rooftop_payments_order
  on public.rooftop_order_payments (order_id);
create index if not exists idx_rooftop_payments_hotel_date
  on public.rooftop_order_payments (hotel_id, date_service);

alter table public.rooftop_order_payments enable row level security;
drop policy if exists "rooftop_order_payments manage" on public.rooftop_order_payments;
create policy "rooftop_order_payments manage" on public.rooftop_order_payments
  for all to authenticated using (true) with check (true);

-- payment_method sur rooftop_orders devient informatif (dernier moyen / 'multi').
-- On assouplit le check pour accepter 'multi'.
alter table public.rooftop_orders drop constraint if exists rooftop_orders_payment_method_check;
alter table public.rooftop_orders
  add constraint rooftop_orders_payment_method_check
  check (payment_method in ('tpe', 'espece', 'chambre', 'multi'));
