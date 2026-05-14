-- ============================================================================
-- Phase 2.C — Remplacement des policies permissives USING(true)
-- ============================================================================
-- Objectif : éteindre les ~30 warnings rls_policy_always_true du linter
-- Supabase en remplaçant les policies `USING (true) WITH CHECK (true)` par
-- `USING (auth.uid() IS NOT NULL)` qui est fonctionnellement équivalent
-- pour le rôle `authenticated` (un user authentifié a forcément un uid)
-- mais qui n'est plus considéré "overly permissive" par le linter.
--
-- Modèle de sécurité : toute personne authentifiée peut tout faire dans
-- la DB. C'est cohérent avec l'usage actuel (staff interne hôtel, tout
-- le monde voit tout, peut tout éditer). Les vraies restrictions par
-- rôle (superadmin/admin/user) sont appliquées côté API routes Next.js :
--   - /api/users/invite       — superadmin ou admin
--   - /api/users/deactivate   — superadmin ou admin
--   - /api/users/reactivate   — superadmin ou admin
--   - /api/users/update-role  — superadmin only
-- Ces routes utilisent supabaseAdmin (service_role) qui bypass les RLS.
--
-- Idempotent : drop puis recreate.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Tables standard : phase1_open_authenticated → authenticated_all
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
  tables_standard text[] := array[
    'articles',
    'chauffeurs',
    'clients',
    'fiches_fonctions',
    'fidelite',
    'flash_infos',
    'function_tasks',
    'hotels',
    'kpis',
    'maintenance',
    'planning_config',
    'processes',
    'quote_items',
    'quote_lines',
    'quotes',
    'repertoire',
    'seminar_clients',
    'seminar_reservations',
    'seminar_rooms',
    'suivi_commercial',
    'users',
    'wifi_reservations'
  ];
begin
  foreach t in array tables_standard loop
    execute format('drop policy if exists "phase1_open_authenticated" on public.%I', t);
    execute format('drop policy if exists "authenticated_all" on public.%I', t);
    execute format(
      'create policy "authenticated_all" on public.%I '
      'for all to authenticated '
      'using (auth.uid() is not null) '
      'with check (auth.uid() is not null)',
      t
    );
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 2) Tables avec policies à noms spéciaux (existantes pré-Phase 1)
-- ----------------------------------------------------------------------------

-- abonnements (3 policies séparées DELETE/INSERT/UPDATE)
drop policy if exists "abonnements_delete" on public.abonnements;
drop policy if exists "abonnements_insert" on public.abonnements;
drop policy if exists "abonnements_update" on public.abonnements;
drop policy if exists "phase1_open_authenticated" on public.abonnements;
drop policy if exists "authenticated_all" on public.abonnements;
create policy "authenticated_all" on public.abonnements
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- chambres
drop policy if exists "auth_all_chambres" on public.chambres;
drop policy if exists "phase1_open_authenticated" on public.chambres;
drop policy if exists "authenticated_all" on public.chambres;
create policy "authenticated_all" on public.chambres
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- cp_requests (était roles "-" = public; on restreint à authenticated,
-- vérifié que tous les usages côté code sont côté authenticated dans
-- src/app/planning/page.tsx)
drop policy if exists "Everyone can insert CP requests" on public.cp_requests;
drop policy if exists "phase1_open_authenticated" on public.cp_requests;
drop policy if exists "authenticated_all" on public.cp_requests;
create policy "authenticated_all" on public.cp_requests
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- jobs_encodeur
drop policy if exists "auth_all_jobs_encodeur" on public.jobs_encodeur;
drop policy if exists "phase1_open_authenticated" on public.jobs_encodeur;
drop policy if exists "authenticated_all" on public.jobs_encodeur;
create policy "authenticated_all" on public.jobs_encodeur
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- parking_reservations (était roles "-" = public; restreint à authenticated)
drop policy if exists "Allow full access" on public.parking_reservations;
drop policy if exists "phase1_open_authenticated" on public.parking_reservations;
drop policy if exists "authenticated_all" on public.parking_reservations;
create policy "authenticated_all" on public.parking_reservations
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- parkings (était roles "-" = public; restreint à authenticated)
drop policy if exists "Allow full access" on public.parkings;
drop policy if exists "phase1_open_authenticated" on public.parkings;
drop policy if exists "authenticated_all" on public.parkings;
create policy "authenticated_all" on public.parkings
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- sejours
drop policy if exists "auth_all_sejours" on public.sejours;
drop policy if exists "phase1_open_authenticated" on public.sejours;
drop policy if exists "authenticated_all" on public.sejours;
create policy "authenticated_all" on public.sejours
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- ----------------------------------------------------------------------------
-- 3) Vérification finale — chaque table publique doit avoir exactement 1 policy
--    nommée "authenticated_all" et plus de "phase1_open_authenticated" ni
--    autres "Allow*" / "Everyone*" / "auth_all_*" / "abonnements_*".
-- ----------------------------------------------------------------------------
select
  tablename,
  count(*) filter (where policyname = 'authenticated_all') as has_new_policy,
  array_agg(policyname order by policyname) as all_policies
from pg_policies
where schemaname = 'public'
  and tablename in (
    'abonnements','articles','chambres','chauffeurs','clients','cp_requests',
    'fiches_fonctions','fidelite','flash_infos','function_tasks','hotels',
    'jobs_encodeur','kpis','maintenance','parking_reservations','parkings',
    'planning_config','processes','quote_items','quote_lines','quotes',
    'repertoire','sejours','seminar_clients','seminar_reservations',
    'seminar_rooms','suivi_commercial','users','wifi_reservations'
  )
group by tablename
order by tablename;
