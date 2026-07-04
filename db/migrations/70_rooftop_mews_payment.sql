-- POS Rooftop — traçabilité du push paiement vers Mews.
-- Quand un règlement TPE/espèces est enregistré localement, on le consigne aussi
-- dans Mews (payments/addExternal sur le compte « Rooftop 2026 »). On stocke l'Id
-- du paiement Mews renvoyé pour : (1) savoir qu'une ligne est déjà synchronisée
-- — retirer une ligne déjà poussée ne l'annule PAS côté Mews, on alerte l'user ;
-- (2) permettre un re-push si l'appel Mews avait échoué (colonne restée nulle).
-- À coller dans le SQL editor Supabase (après 69_agent_heartbeat.sql).

alter table public.rooftop_order_payments
  add column if not exists mews_payment_id text;
