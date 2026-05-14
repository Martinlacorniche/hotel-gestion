-- ============================================================================
-- Phase 2.B — Révoquer execute pour authenticated sur ban_user / unban_user
-- ============================================================================
-- Corrige les 2 derniers warnings :
--   authenticated_security_definer_function_executable sur public.ban_user
--   authenticated_security_definer_function_executable sur public.unban_user
--
-- Tous les appels supabase.rpc('ban_user') / rpc('unban_user') ont été
-- migrés vers les API routes Next.js :
--   - /api/users/deactivate  (utilise supabaseAdmin.auth.admin.updateUserById)
--   - /api/users/reactivate
-- qui passent par le service_role et n'utilisent plus ces RPC.
--
-- Les RPC restent dans la base (pas drop) au cas où, mais ne sont plus
-- callable par anon ni par authenticated. Seul service_role peut encore
-- les invoquer en interne si besoin.
--
-- Idempotent.
-- ============================================================================

revoke execute on function public.ban_user(uuid)   from authenticated;
revoke execute on function public.unban_user(uuid) from authenticated;

-- Vérification : la colonne acl ne doit plus contenir 'authenticated=X/...'
select
  p.proname,
  array(
    select rolname || '=' || privilege_type
    from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name = p.proname
  ) as privileges
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('ban_user', 'unban_user');
