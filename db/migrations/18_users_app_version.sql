-- ============================================================================
-- 18 — Suivi de version de l'app mobile par utilisateur
-- ============================================================================
-- L'app Expo rapporte sa version à chaque ouverture de session (AuthContext).
-- Permet de savoir QUI est à jour après une release ("qui n'a pas encore la
-- 9.0.1 ?") au lieu de deviner via les stats des stores. Les versions
-- antérieures à la 9.0.1 ne rapportent rien → app_version NULL = pas à jour.
--
-- Idempotent : à jouer dans le SQL Editor Supabase (avant ou après le build).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS app_version text,
  ADD COLUMN IF NOT EXISTS app_version_updated_at timestamptz;
