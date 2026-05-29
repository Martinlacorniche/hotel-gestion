-- ============================================================================
-- RLS — Réseaux de climatisation (public.clim_reseaux)
-- ============================================================================
-- Lecture : tout utilisateur authentifié (donnée de référence, non sensible).
-- Écriture (insert/update/delete) : admin / superadmin uniquement.
-- Même pattern role-based que 07_fix_admin_role_policies.sql.
-- Idempotent.
-- ============================================================================

alter table public.clim_reseaux enable row level security;

drop policy if exists "clim_select_auth" on public.clim_reseaux;
create policy "clim_select_auth" on public.clim_reseaux
  for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "clim_insert_admin" on public.clim_reseaux;
create policy "clim_insert_admin" on public.clim_reseaux
  for insert to authenticated
  with check (exists (select 1 from public.users where id_auth = auth.uid() and role in ('admin','superadmin')));

drop policy if exists "clim_update_admin" on public.clim_reseaux;
create policy "clim_update_admin" on public.clim_reseaux
  for update to authenticated
  using      (exists (select 1 from public.users where id_auth = auth.uid() and role in ('admin','superadmin')))
  with check (exists (select 1 from public.users where id_auth = auth.uid() and role in ('admin','superadmin')));

drop policy if exists "clim_delete_admin" on public.clim_reseaux;
create policy "clim_delete_admin" on public.clim_reseaux
  for delete to authenticated
  using (exists (select 1 from public.users where id_auth = auth.uid() and role in ('admin','superadmin')));

-- Vérification
select policyname, cmd from pg_policies
where schemaname = 'public' and tablename = 'clim_reseaux'
order by policyname;
