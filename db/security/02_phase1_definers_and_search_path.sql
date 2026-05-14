-- ============================================================================
-- Phase 1.B — SECURITY DEFINER + search_path mutable
-- ============================================================================
-- Corrige les warnings :
--  - security_definer_view (view_planning_seminaires)
--  - function_search_path_mutable (4 fonctions)
--  - anon_security_definer_function_executable (ban_user, unban_user)
--
-- Idempotent. À jouer après le script 01.
-- ============================================================================

-- 1) View planning séminaires : passer en SECURITY INVOKER pour qu'elle
--    respecte les RLS de l'utilisateur qui l'interroge (pas du créateur).
alter view public.view_planning_seminaires set (security_invoker = true);

-- 2) Fonctions : fixer search_path = public, pg_temp pour éviter le détournement
--    via un schéma de plus haute priorité dans le search_path de l'appelant.
alter function public.sync_planning_config()       set search_path = public, pg_temp;
alter function public.handle_processes_updated_at() set search_path = public, pg_temp;
alter function public.ban_user(uuid)               set search_path = public, pg_temp;
alter function public.unban_user(uuid)             set search_path = public, pg_temp;

-- 3) ban_user / unban_user : EXECUTE révoqué pour anon UNIQUEMENT.
--    On garde l'accès `authenticated` pour ne pas casser les appels actuels
--    depuis src/app/page.tsx (supabase.rpc('ban_user',...)).
--    Ces appels seront migrés vers une API route Next.js dans le chantier
--    "refonte gestion users", après quoi on pourra révoquer aussi pour
--    authenticated (cf. db/security/03_phase2_revoke_admin_funcs.sql à créer).
revoke execute on function public.ban_user(uuid)   from anon, public;
revoke execute on function public.unban_user(uuid) from anon, public;
