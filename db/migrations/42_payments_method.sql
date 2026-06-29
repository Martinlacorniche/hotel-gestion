-- TPE virtuel : distingue un encaissement par LIEN de paiement d'un encaissement
-- par TERMINAL CARTE (carte saisie sur place / au téléphone, MOTO).
-- À coller dans le SQL editor Supabase (après 32_payments_audit.sql).

alter table public.payments
  add column if not exists method text
    check (method is null or method in ('lien', 'tpe'));   -- null = anciens enregistrements (lien)
