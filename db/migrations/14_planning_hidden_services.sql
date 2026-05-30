-- ============================================================================
-- Préférence par utilisateur : services masqués dans le planning
-- ============================================================================
-- Chaque manager peut masquer les services qui ne le concernent pas (ex. le
-- manager F&B ne voit que F&B). Stocké par user pour suivre sur tous ses
-- appareils. Même esprit que users.pinned_tools (text[] de préférences).
--
-- Additif (colonne avec défaut) → pas de fenêtre cassée : l'ancien code
-- ignore la colonne, le nouveau la lit. Idempotent.
-- ============================================================================

alter table public.users
  add column if not exists planning_hidden_services text[] not null default '{}';
