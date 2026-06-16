-- ============================================================================
-- HACCP Phase 1 — RLS policies (plan de nettoyage)
-- ============================================================================
-- Même pattern que 08_haccp_temperature_rls.sql / 09_haccp_documents_rls.sql :
--   1 policy "authenticated_all" par table — tout utilisateur authentifié
--   peut tout (read/insert/update/delete). Les restrictions par rôle
--   (superadmin/admin/user) sont gérées côté API routes Next.js avec
--   supabaseAdmin (service_role bypass) — ici on ne fait que rendre les
--   tables lisibles via la clé anon/authenticated.
--
-- Idempotent.
-- ============================================================================

-- 1) Enable RLS
alter table public.haccp_cleaning_zones enable row level security;
alter table public.haccp_cleaning_tasks enable row level security;
alter table public.haccp_cleaning_logs  enable row level security;

-- 2) Policies "authenticated_all"
do $$
declare
  t text;
  tables_haccp_cleaning text[] := array[
    'haccp_cleaning_zones',
    'haccp_cleaning_tasks',
    'haccp_cleaning_logs'
  ];
begin
  foreach t in array tables_haccp_cleaning loop
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

-- 3) Vérification finale — chaque table doit avoir exactement 1 policy.
select
  tablename,
  count(*) filter (where policyname = 'authenticated_all') as has_new_policy,
  array_agg(policyname order by policyname) as all_policies
from pg_policies
where schemaname = 'public'
  and tablename in ('haccp_cleaning_zones', 'haccp_cleaning_tasks', 'haccp_cleaning_logs')
group by tablename
order by tablename;
