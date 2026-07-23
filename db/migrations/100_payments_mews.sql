-- 100 — Rattachement d'un encaissement à une réservation Mews (Les Voiles).
--
-- Jusqu'ici la réception encaissait via Stripe puis RESSAISISSAIT le règlement
-- dans le PMS à la main — d'où la case `pms_done` et le bouton « copier le
-- montant » de la page /encaissement. `payments/addExternal` permet de le poser
-- directement sur le folio du client ; encore faut-il savoir DE QUEL client il
-- s'agit, ce que Stripe ignore.
--
-- D'où ces colonnes : la réservation choisie au comptoir (via la recherche par
-- nom), et l'identifiant du paiement créé dans Mews.
--
-- `mews_payment_id` renseigné = déjà transmis, on ne repousse jamais : un
-- paiement en double sur un folio se solde par un remboursement à tort.
-- ⚠️ La Corniche tourne sur HotSoft : ces colonnes restent nulles pour elle.

alter table public.payments
  add column if not exists mews_customer_id    text,
  add column if not exists mews_reservation_id text,
  add column if not exists mews_payment_id     text;

comment on column public.payments.mews_customer_id is
  'Compte Mews crédité (AccountType « Customer » — les lignes d''une résa vivent sur le compte client).';
comment on column public.payments.mews_reservation_id is
  'Réservation choisie au comptoir, pour retrouver le séjour concerné.';
comment on column public.payments.mews_payment_id is
  'Id du paiement créé dans Mews. Renseigné = déjà transmis, ne jamais repousser.';
