-- ============================================================================
-- Module Groupes (refonte) — RLS pour chambres + tables recréées
-- ============================================================================
-- Après la migration 24 : la table `chambres` est nouvelle, et `groupe_chambres`
-- / `groupe_reservations` ont été recréées (leurs anciennes policies du script 17
-- ont donc disparu avec le DROP). On (ré)applique le pattern "authenticated_all".
-- `room_types` et `groupes` gardent leurs policies du script 17 (inchangées).
-- Idempotent. À coller dans le SQL editor (après la migration 24).
-- ============================================================================

alter table public.chambres            enable row level security;
alter table public.groupe_chambres     enable row level security;
alter table public.groupe_reservations enable row level security;

drop policy if exists "authenticated_all" on public.chambres;
create policy "authenticated_all" on public.chambres
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
  and tablename in ('chambres', 'groupe_chambres', 'groupe_reservations')
order by tablename;
