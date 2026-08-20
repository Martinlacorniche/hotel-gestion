-- ============================================================================
-- RLS — Entretien récurrent (entretien_taches, entretien_evenements)
-- ============================================================================
-- Catalogue des tâches : lecture pour tout authentifié, écriture admin only
--   (même pattern que 12_clim_reseaux_rls.sql).
-- Événements : n'importe quel authentifié peut pointer un passage, corriger
--   ou supprimer un clic de trop — c'est le geste de terrain.
-- Idempotent.
-- ============================================================================

alter table public.entretien_taches     enable row level security;
alter table public.entretien_evenements enable row level security;

-- --- Catalogue ---------------------------------------------------------------
drop policy if exists "entretien_taches_select_auth" on public.entretien_taches;
create policy "entretien_taches_select_auth" on public.entretien_taches
  for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "entretien_taches_insert_admin" on public.entretien_taches;
create policy "entretien_taches_insert_admin" on public.entretien_taches
  for insert to authenticated
  with check (exists (select 1 from public.users where id_auth = auth.uid() and role in ('admin','superadmin')));

drop policy if exists "entretien_taches_update_admin" on public.entretien_taches;
create policy "entretien_taches_update_admin" on public.entretien_taches
  for update to authenticated
  using      (exists (select 1 from public.users where id_auth = auth.uid() and role in ('admin','superadmin')))
  with check (exists (select 1 from public.users where id_auth = auth.uid() and role in ('admin','superadmin')));

drop policy if exists "entretien_taches_delete_admin" on public.entretien_taches;
create policy "entretien_taches_delete_admin" on public.entretien_taches
  for delete to authenticated
  using (exists (select 1 from public.users where id_auth = auth.uid() and role in ('admin','superadmin')));

-- --- Événements (les clics) --------------------------------------------------
drop policy if exists "entretien_evts_select_auth" on public.entretien_evenements;
create policy "entretien_evts_select_auth" on public.entretien_evenements
  for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "entretien_evts_insert_auth" on public.entretien_evenements;
create policy "entretien_evts_insert_auth" on public.entretien_evenements
  for insert to authenticated
  with check (auth.uid() is not null);

drop policy if exists "entretien_evts_update_auth" on public.entretien_evenements;
create policy "entretien_evts_update_auth" on public.entretien_evenements
  for update to authenticated
  using      (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "entretien_evts_delete_auth" on public.entretien_evenements;
create policy "entretien_evts_delete_auth" on public.entretien_evenements
  for delete to authenticated
  using (auth.uid() is not null);

select tablename, policyname, cmd from pg_policies
where schemaname = 'public' and tablename in ('entretien_taches','entretien_evenements')
order by tablename, policyname;
