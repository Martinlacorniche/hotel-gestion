-- ============================================================================
-- Renomme la police 'caveat' (illisible car x-height très petite) en 'kalam'
-- (handwritten plus épaisse, vraiment lisible).
-- ============================================================================

-- 1) Migrer les éventuels users qui avaient déjà choisi 'caveat'
update public.users
set font_family = 'kalam'
where font_family = 'caveat';

-- 2) Mettre à jour le CHECK constraint pour accepter 'kalam' au lieu de 'caveat'
alter table public.users drop constraint if exists users_font_family_check;
alter table public.users
  add constraint users_font_family_check
  check (font_family in ('inter','poppins','dm_sans','lora','playfair','kalam'));
