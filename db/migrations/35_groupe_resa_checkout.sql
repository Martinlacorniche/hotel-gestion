-- Lien réservation invité ↔ session de paiement Stripe.
-- Une session Checkout couvre toutes les chambres d'un même hôtel pour un booking
-- (multi-hôtels = une session par hôtel, donc par compte Stripe). Le webhook
-- confirme/libère les réservations via ce checkout id.
alter table public.groupe_reservations
  add column if not exists stripe_checkout_id text;
create index if not exists idx_groupe_resa_checkout
  on public.groupe_reservations (stripe_checkout_id);
