-- ============================================================================
-- Phase 2.D — Patch des RLS policies qui filtraient role='admin' strict
-- ============================================================================
-- Contexte : la migration 04_phase2_users_roles.sql a renommé 'employe' → 'user'
-- et a promu Martin (et potentiellement d'autres) en 'superadmin'. Plusieurs
-- RLS policies sur des tables métier (planning_entries, planning_config,
-- cp_requests, default_shift_hours, creneaux) testaient strictement
-- `users.role = 'admin'` → les superadmin se sont retrouvés bloqués (403
-- Forbidden côté client) sur ces tables après la migration.
--
-- Ce script recrée explicitement les 10 policies concernées avec un
-- `role IN ('admin', 'superadmin')` à la place. Idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- creneaux (INSERT / UPDATE / DELETE)
-- ---------------------------------------------------------------------------
drop policy if exists "Admin can insert any creneaux" on public.creneaux;
create policy "Admin can insert any creneaux" on public.creneaux
  for insert to public
  with check (exists (select 1 from public.users where id_auth = auth.uid() and role in ('admin','superadmin')));

drop policy if exists "Admin peut modifier" on public.creneaux;
create policy "Admin peut modifier" on public.creneaux
  for update to public
  using      (exists (select 1 from public.users where id_auth = auth.uid() and role in ('admin','superadmin')))
  with check (exists (select 1 from public.users where id_auth = auth.uid() and role in ('admin','superadmin')));

drop policy if exists "Admin peut supprimer" on public.creneaux;
create policy "Admin peut supprimer" on public.creneaux
  for delete to public
  using (exists (select 1 from public.users where id_auth = auth.uid() and role in ('admin','superadmin')));

-- ---------------------------------------------------------------------------
-- default_shift_hours (INSERT / UPDATE)
-- ---------------------------------------------------------------------------
drop policy if exists "Admins can insert default shifts" on public.default_shift_hours;
create policy "Admins can insert default shifts" on public.default_shift_hours
  for insert to public
  with check (exists (select 1 from public.users where id_auth = auth.uid() and role in ('admin','superadmin')));

drop policy if exists "Admins can update default shifts" on public.default_shift_hours;
create policy "Admins can update default shifts" on public.default_shift_hours
  for update to public
  using      (exists (select 1 from public.users where id_auth = auth.uid() and role in ('admin','superadmin')))
  with check (exists (select 1 from public.users where id_auth = auth.uid() and role in ('admin','superadmin')));

-- ---------------------------------------------------------------------------
-- cp_requests (ALL)
-- ---------------------------------------------------------------------------
drop policy if exists "Admins can manage all CP" on public.cp_requests;
create policy "Admins can manage all CP" on public.cp_requests
  for all to public
  using      (exists (select 1 from public.users where id_auth = auth.uid() and role in ('admin','superadmin')))
  with check (exists (select 1 from public.users where id_auth = auth.uid() and role in ('admin','superadmin')));

-- ---------------------------------------------------------------------------
-- planning_config (ALL + SELECT)
-- ---------------------------------------------------------------------------
drop policy if exists "Admins can manage config" on public.planning_config;
create policy "Admins can manage config" on public.planning_config
  for all to public
  using      (exists (select 1 from public.users where id_auth = auth.uid() and role in ('admin','superadmin')))
  with check (exists (select 1 from public.users where id_auth = auth.uid() and role in ('admin','superadmin')));

drop policy if exists "Admins can read config" on public.planning_config;
create policy "Admins can read config" on public.planning_config
  for select to public
  using (exists (select 1 from public.users where id_auth = auth.uid() and role in ('admin','superadmin')));

-- ---------------------------------------------------------------------------
-- planning_entries (ALL + SELECT)
-- ---------------------------------------------------------------------------
drop policy if exists "Admins can manage planning" on public.planning_entries;
create policy "Admins can manage planning" on public.planning_entries
  for all to public
  using      (exists (select 1 from public.users where id_auth = auth.uid() and role in ('admin','superadmin')))
  with check (exists (select 1 from public.users where id_auth = auth.uid() and role in ('admin','superadmin')));

drop policy if exists "Admins can read all planning" on public.planning_entries;
create policy "Admins can read all planning" on public.planning_entries
  for select to public
  using (exists (select 1 from public.users where id_auth = auth.uid() and role in ('admin','superadmin')));

-- ---------------------------------------------------------------------------
-- Cleanup : la policy temporaire posée comme workaround devient inutile
-- ---------------------------------------------------------------------------
drop policy if exists "planning_entries_authenticated_all" on public.planning_entries;

-- ---------------------------------------------------------------------------
-- Vérification finale : doit retourner 0 ligne
-- ---------------------------------------------------------------------------
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and (qual::text ~ 'role\s*=\s*''admin''' or with_check::text ~ 'role\s*=\s*''admin''');
