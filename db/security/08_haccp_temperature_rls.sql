-- ============================================================================
-- HACCP Phase 1 — RLS policies (températures)
-- ============================================================================
-- Cohérent avec 06_phase2_rls_policies.sql :
--   1 policy "authenticated_all" par table — tout utilisateur authentifié
--   peut tout (read/insert/update/delete). Les restrictions par rôle
--   (superadmin/admin/user) sont gérées côté API routes Next.js avec
--   supabaseAdmin (service_role bypass).
--
-- Idempotent.
-- ============================================================================

-- 1) Enable RLS
alter table public.haccp_sensors  enable row level security;
alter table public.haccp_readings enable row level security;
alter table public.haccp_alerts   enable row level security;

-- 2) Policies "authenticated_all" — pattern uniforme du repo
do $$
declare
  t text;
  tables_haccp text[] := array[
    'haccp_sensors',
    'haccp_readings',
    'haccp_alerts'
  ];
begin
  foreach t in array tables_haccp loop
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

-- 3) Vérification finale — chaque table HACCP doit avoir exactement 1 policy.
select
  tablename,
  count(*) filter (where policyname = 'authenticated_all') as has_new_policy,
  array_agg(policyname order by policyname) as all_policies
from pg_policies
where schemaname = 'public'
  and tablename in ('haccp_sensors', 'haccp_readings', 'haccp_alerts')
group by tablename
order by tablename;
