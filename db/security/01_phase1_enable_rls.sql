-- ============================================================================
-- Phase 1.A — Activer RLS partout en mode permissif
-- ============================================================================
-- Objectif : éteindre les ERROR Supabase ("rls_disabled_in_public" et
-- "policy_exists_rls_disabled") sans rien casser pour les utilisateurs
-- internes Corniche/Voiles. Les policies créées ici sont volontairement
-- permissives (USING true) — elles seront resserrées en Phase 2 avec un
-- filtre par hotel_id basé sur l'utilisateur connecté.
--
-- Le script est idempotent : peut être rejoué sans risque.
--
-- À exécuter : Supabase Dashboard > SQL Editor > coller > Run.
-- ============================================================================

-- 1) Tables sans aucune policy existante
--    ENABLE RLS bloquerait tout accès (sauf service_role) → on ajoute
--    immédiatement une policy permissive pour les utilisateurs authentifiés.
do $$
declare
  t text;
  tables_no_policy text[] := array[
    'kpis',
    'hotels',
    'repertoire',
    'chauffeurs',
    'clients',
    'fidelite',
    'users',
    'processes',
    'flash_infos',
    'quote_items',
    'fiches_fonctions',
    'wifi_reservations'
  ];
begin
  foreach t in array tables_no_policy loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "phase1_open_authenticated" on public.%I', t);
    execute format(
      'create policy "phase1_open_authenticated" on public.%I '
      'for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;

-- 2) Tables qui ont déjà des policies mais RLS désactivé
--    On active simplement RLS. Les policies existantes peuvent être
--    restrictives (filtre hotel_id) — pour ne rien casser pendant la
--    transition, on ajoute en parallèle une policy permissive
--    "phase1_open_authenticated" qui sera supprimée en Phase 2 quand
--    les vraies policies seront validées.
do $$
declare
  t text;
  tables_with_policy text[] := array[
    'articles',
    'function_tasks',
    'maintenance',
    'planning_config',
    'quote_lines',
    'quotes',
    'seminar_clients',
    'seminar_reservations',
    'seminar_rooms',
    'suivi_commercial'
  ];
begin
  foreach t in array tables_with_policy loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "phase1_open_authenticated" on public.%I', t);
    execute format(
      'create policy "phase1_open_authenticated" on public.%I '
      'for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;

-- 3) Vérification rapide : lister les tables publiques et leur état RLS.
--    Toutes doivent afficher rowsecurity = true après ce script.
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
