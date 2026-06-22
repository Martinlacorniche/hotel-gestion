-- Paiements Stripe unifiés (TPE virtuel siteconsignes + paiements invités groupes + dossiers commerciaux).
-- À coller dans le SQL editor Supabase.
-- L'écriture se fait UNIQUEMENT via les API routes (service_role) ; aucune écriture client direct.

create table if not exists public.payments (
  id                       uuid primary key default gen_random_uuid(),
  hotel_id                 uuid references public.hotels(id) on delete set null,
  type                     text not null default 'manuel'
                             check (type in ('manuel', 'groupe_resa', 'dossier_commercial')),
  -- liens optionnels vers l'entité concernée
  lead_id                  uuid,           -- suivi_commercial.id
  groupe_reservation_id    uuid,           -- groupe_reservations.id

  amount                   numeric(10,2) not null,   -- montant en euros
  currency                 text not null default 'eur',
  description              text,
  client_nom               text,
  email                    text,

  status                   text not null default 'open'
                             check (status in ('open', 'paid', 'failed', 'refunded', 'canceled')),

  stripe_customer_id       text,
  stripe_invoice_id        text,
  stripe_payment_intent_id text,
  stripe_checkout_id       text,
  hosted_invoice_url       text,           -- lien de paiement à copier / envoyer

  created_at               timestamptz default now(),
  paid_at                  timestamptz,
  refunded_at              timestamptz
);

create index if not exists idx_payments_hotel   on public.payments (hotel_id, created_at desc);
create index if not exists idx_payments_status  on public.payments (status);
create index if not exists idx_payments_invoice on public.payments (stripe_invoice_id);
create index if not exists idx_payments_pi       on public.payments (stripe_payment_intent_id);

alter table public.payments enable row level security;

-- Lecture : utilisateur authentifié (l'historique est affiché côté admin ; UI gate le rôle).
drop policy if exists "payments read" on public.payments;
create policy "payments read" on public.payments
  for select to authenticated using (true);

-- Pas de policy d'écriture pour 'authenticated' : tout passe par les API routes
-- en service_role (création de paiement, webhook, remboursement) → plus sûr pour de l'argent.
