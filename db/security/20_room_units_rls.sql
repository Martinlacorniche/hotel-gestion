-- ============================================================================
-- Module Groupes — RLS pour room_units + tables d'allotement recréées
-- ============================================================================
-- Après la migration 25 : `room_units` est nouvelle, `groupe_chambres` /
-- `groupe_reservations` ont été recréées (policies du script 17/19 disparues).
-- On (ré)applique le pattern "authenticated_all". La table `chambres` (serrures)
-- n'est PAS touchée ici — elle garde ses propres policies.
-- Idempotent. À coller après la migration 25.
-- ============================================================================

alter table public.room_units          enable row level security;
alter table public.groupe_chambres     enable row level security;
alter table public.groupe_reservations enable row level security;

drop policy if exists "authenticated_all" on public.room_units;
create policy "authenticated_all" on public.room_units
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "authenticated_all" on public.groupe_chambres;
create policy "authenticated_all" on public.groupe_chambres
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "authenticated_all" on public.groupe_reservations;
create policy "authenticated_all" on public.groupe_reservations
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- Vérification : doit retourner 3 lignes
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and tablename in ('room_units', 'groupe_chambres', 'groupe_reservations')
order by tablename;
