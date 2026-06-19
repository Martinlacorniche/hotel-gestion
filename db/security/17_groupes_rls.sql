-- ============================================================================
-- Module Groupes — RLS policies
-- ============================================================================
-- Pattern "authenticated_all" : tout utilisateur authentifié (back-office) peut
-- lire/écrire. Le scope par hôtel est géré côté app. La frontière de sécurité
-- du projet est le RÔLE, pas le hotel_id.
--
-- IMPORTANT : la page publique invité (Site-BW) n'est PAS authentifiée. Elle
-- accédera à ces tables via des API routes service_role (Phase 2), qui bypassent
-- la RLS. On n'ouvre donc RIEN à anon ici → la liste nominative reste back-office.
-- Idempotent. À coller dans le SQL editor Supabase (après la migration 23).
-- ============================================================================

alter table public.room_types          enable row level security;
alter table public.groupes             enable row level security;
alter table public.groupe_chambres     enable row level security;
alter table public.groupe_reservations enable row level security;

drop policy if exists "authenticated_all" on public.room_types;
create policy "authenticated_all" on public.room_types
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "authenticated_all" on public.groupes;
create policy "authenticated_all" on public.groupes
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

-- Vérification : doit retourner 4 lignes
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and tablename in ('room_types', 'groupes', 'groupe_chambres', 'groupe_reservations')
order by tablename;
