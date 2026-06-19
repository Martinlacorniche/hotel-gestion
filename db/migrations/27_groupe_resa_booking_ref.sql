-- ============================================================================
-- Module Groupes — Regroupement multi-chambres d'une même réservation invité
-- ============================================================================
-- Un invité peut réserver plusieurs chambres en une fois : toutes les lignes
-- partagent un `booking_ref` (+ même email + même code_pin). Le lien perso et
-- le code à 4 chiffres gèrent l'ensemble des chambres du booking.
-- Idempotent. À coller dans le SQL editor Supabase.
-- ============================================================================

alter table public.groupe_reservations add column if not exists booking_ref uuid;

-- Valeur par défaut auto (filet de sécurité : toute ligne a toujours un booking_ref,
-- même si un code l'oublie). Le batch multi-chambres pose un booking_ref explicite partagé.
alter table public.groupe_reservations alter column booking_ref set default gen_random_uuid();

-- Backfill des réservations existantes (créées avant cette colonne) : chacune son ref.
update public.groupe_reservations set booking_ref = gen_random_uuid() where booking_ref is null;

create index if not exists idx_groupe_resa_bookingref on public.groupe_reservations(booking_ref);
