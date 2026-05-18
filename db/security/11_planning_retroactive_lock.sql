-- ============================================================================
-- Verrouillage rétroactif planning + CP — conservation légale
-- ============================================================================
-- Empêche toute modification (INSERT/UPDATE/DELETE) de :
--   * planning_entries dont `date` est antérieure à J-7
--   * cp_requests dont `end_date` est antérieure à J-7
--
-- Seul le superadmin peut contourner ce verrou (correction d'erreur tardive
-- traçable dans les logs Supabase).
--
-- Implémentation : policies RESTRICTIVE — celles-ci sont AND'ées avec les
-- policies PERMISSIVE existantes (authenticated_all, Admins can manage…).
-- Donc l'accès est accordé seulement si TOUTES les RESTRICTIVE passent ET
-- au moins une PERMISSIVE passe.
--
-- SELECT n'est PAS bloqué — la lecture du passé reste libre (consultation,
-- export, historique). Le verrou ne concerne que l'écriture.
-- ============================================================================

create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id_auth = auth.uid() and role = 'superadmin'
  );
$$;

revoke all on function public.is_superadmin() from public;
grant execute on function public.is_superadmin() to authenticated;

-- ----------------------------------------------------------------------------
-- planning_entries : lock sur `date`
-- ----------------------------------------------------------------------------
drop policy if exists "planning_entries_retro_lock_update" on public.planning_entries;
drop policy if exists "planning_entries_retro_lock_delete" on public.planning_entries;
drop policy if exists "planning_entries_retro_lock_insert" on public.planning_entries;

create policy "planning_entries_retro_lock_update" on public.planning_entries
  as restrictive
  for update to authenticated
  using (date >= (current_date - interval '7 days') or public.is_superadmin())
  with check (date >= (current_date - interval '7 days') or public.is_superadmin());

create policy "planning_entries_retro_lock_delete" on public.planning_entries
  as restrictive
  for delete to authenticated
  using (date >= (current_date - interval '7 days') or public.is_superadmin());

create policy "planning_entries_retro_lock_insert" on public.planning_entries
  as restrictive
  for insert to authenticated
  with check (date >= (current_date - interval '7 days') or public.is_superadmin());

-- ----------------------------------------------------------------------------
-- cp_requests : lock sur `end_date`
-- ----------------------------------------------------------------------------
drop policy if exists "cp_requests_retro_lock_update" on public.cp_requests;
drop policy if exists "cp_requests_retro_lock_delete" on public.cp_requests;
drop policy if exists "cp_requests_retro_lock_insert" on public.cp_requests;

create policy "cp_requests_retro_lock_update" on public.cp_requests
  as restrictive
  for update to authenticated
  using (end_date >= (current_date - interval '7 days') or public.is_superadmin())
  with check (end_date >= (current_date - interval '7 days') or public.is_superadmin());

create policy "cp_requests_retro_lock_delete" on public.cp_requests
  as restrictive
  for delete to authenticated
  using (end_date >= (current_date - interval '7 days') or public.is_superadmin());

create policy "cp_requests_retro_lock_insert" on public.cp_requests
  as restrictive
  for insert to authenticated
  with check (end_date >= (current_date - interval '7 days') or public.is_superadmin());

-- ----------------------------------------------------------------------------
-- Vérification
-- ----------------------------------------------------------------------------
select tablename, policyname, permissive, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('planning_entries', 'cp_requests')
order by tablename, policyname;
