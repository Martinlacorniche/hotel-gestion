-- ============================================================================
-- Clim incidents — ajout de la colonne photos
-- ============================================================================
-- La migration 20 a été appliquée avant l'ajout des photos. Cette migration
-- ajoute la colonne sur la table existante (idempotente). Sur une nouvelle
-- install, la colonne est déjà créée par 20_clim_incidents.sql → no-op.
--
-- À jouer dans le Supabase SQL Editor.
-- ============================================================================

alter table public.clim_incidents
  add column if not exists photos text[] not null default '{}';
