-- Groupes — paiement en 4 modes (au lieu du booléen paiement_obligatoire).
--   immediat  : Stripe à la réservation (30 min) — comportement actuel
--   differe   : réservation TENUE, lien Stripe envoyé le date_envoi_paiement,
--               48h pour payer puis annulation auto + chambre relâchée
--   optionnel : réservation confirmée gratuite, bouton « Payer maintenant »
--               toujours dispo dans la gestion de résa (aucune obligation)
--   aucun     : gratuit, zéro paiement
-- À coller dans le SQL editor Supabase (après 66_mews_revenue.sql).

alter table public.groupes
  add column if not exists mode_paiement       text,
  add column if not exists date_envoi_paiement date;   -- mode différé uniquement

-- Backfill depuis l'ancien booléen : ON → immédiat, OFF → aucun.
update public.groupes
  set mode_paiement = case when coalesce(paiement_obligatoire, false) then 'immediat' else 'aucun' end
  where mode_paiement is null;

alter table public.groupes alter column mode_paiement set default 'immediat';

-- Suivi de l'envoi du lien (échéance de relâche = payment_link_sent_at + 48h).
alter table public.groupe_reservations
  add column if not exists payment_link_sent_at timestamptz;

-- Anti-doublon : une chambre TENUE en paiement différé bloque aussi le doublon.
drop index if exists uq_resa_chambre_active;
create unique index uq_resa_chambre_active
  on public.groupe_reservations (groupe_chambre_id)
  where statut in ('confirmee', 'en_attente_paiement', 'paiement_differe');
