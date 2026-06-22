-- 1) Suivi PMS des paiements : a-t-on saisi ce règlement dans Mews ?
alter table public.payments
  add column if not exists pms_done boolean not null default false;
create index if not exists idx_payments_pms on public.payments (pms_done) where status = 'paid';

-- 2) Option par groupe : le paiement en ligne est-il obligatoire pour valider une réservation ?
alter table public.groupes
  add column if not exists paiement_obligatoire boolean not null default false;
