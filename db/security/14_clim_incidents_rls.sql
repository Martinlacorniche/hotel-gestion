-- ============================================================================
-- Module Clim — RLS policy (journal d'incidents de climatisation)
-- ============================================================================
-- Même pattern que 11_haccp_cleaning_rls.sql : 1 policy "authenticated_all"
-- — tout utilisateur authentifié peut tout (read/insert/update/delete).
-- Les équipes notent librement sur le terrain ; le scope par hôtel est géré
-- côté app (filtre hotel_id). Idempotent.
-- ============================================================================

alter table public.clim_incidents enable row level security;

drop policy if exists "authenticated_all" on public.clim_incidents;
create policy "authenticated_all" on public.clim_incidents
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- Vérification finale
select
  tablename,
  count(*) filter (where policyname = 'authenticated_all') as has_policy,
  array_agg(policyname order by policyname) as all_policies
from pg_policies
where schemaname = 'public' and tablename = 'clim_incidents'
group by tablename;
