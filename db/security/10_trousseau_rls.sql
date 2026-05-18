-- ============================================================================
-- Fix RLS trousseau — alignement sur le modèle Phase 2
-- ============================================================================
-- Problème : la policy historique `trousseau_hotel_access` filtre sur
-- `hotel_id = (SELECT hotel_id FROM users WHERE id_auth = auth.uid())`
-- → un utilisateur rattaché à Corniche ne voit jamais les identifiants
-- Voiles, même en basculant via le dropdown de la page /trousseau.
-- C'est incohérent avec le modèle Phase 2 (les 28 tables standard sont
-- en `authenticated_all` permissif, la sécurité réelle est côté UI / API).
--
-- Fix : drop l'ancienne policy + create `authenticated_all` (identique
-- aux autres tables multi-hôtels comme `articles`, `repertoire`, etc.)
-- ============================================================================

drop policy if exists "trousseau_hotel_access" on public.trousseau;
drop policy if exists "phase1_open_authenticated" on public.trousseau;
drop policy if exists "authenticated_all" on public.trousseau;

create policy "authenticated_all" on public.trousseau
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- Vérification
select policyname, permissive, roles, cmd
from pg_policies
where schemaname = 'public' and tablename = 'trousseau';
