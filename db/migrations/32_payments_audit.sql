-- Audit des paiements : qui a créé l'encaissement, qui a remboursé et pourquoi.
-- À coller dans le SQL editor Supabase (après 31_payments.sql).

alter table public.payments
  add column if not exists created_by    text,   -- nom de l'utilisateur ayant créé la demande
  add column if not exists refunded_by   text,   -- nom de l'utilisateur ayant remboursé
  add column if not exists refund_reason text;    -- motif du remboursement (obligatoire à la saisie)
