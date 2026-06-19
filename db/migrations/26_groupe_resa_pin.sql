-- ============================================================================
-- Module Groupes — Code PIN à 4 chiffres par réservation invité
-- ============================================================================
-- Sécurise les modifications/annulations : le lien perso seul ne suffit pas,
-- l'invité doit aussi connaître son code à 4 chiffres (créé à la réservation,
-- vérifié côté serveur sur chaque modif/annulation). Empêche un invité d'agir
-- sur la réservation d'un autre.
-- Idempotent. À coller dans le SQL editor Supabase.
-- ============================================================================

alter table public.groupe_reservations add column if not exists code_pin text;
