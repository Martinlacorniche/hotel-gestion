-- ============================================================================
-- Module Occupation Mews — RLS policy (cache taux d'occupation prévisionnel)
-- ============================================================================
-- Donnée agrégée (occupation mois par mois), aucune PII. Tout utilisateur
-- authentifié peut LIRE (le scope par hôtel est filtré côté app, conformément
-- au modèle "frontière de sécurité = rôle, pas hotel_id").
--
-- L'ÉCRITURE est réservée au service_role (la route /api/mews/refresh-occupancy,
-- qui bypass la RLS) : pas de policy d'insert/update pour les clients → un
-- navigateur authentifié ne peut que lire, jamais falsifier les chiffres.
--
-- Idempotent.
-- ============================================================================

alter table public.mews_occupancy enable row level security;

drop policy if exists "authenticated_read" on public.mews_occupancy;
create policy "authenticated_read" on public.mews_occupancy
  for select to authenticated
  using (auth.uid() is not null);

-- Vérification finale
select
  tablename,
  count(*) filter (where policyname = 'authenticated_read') as has_read_policy,
  array_agg(policyname order by policyname) as all_policies
from pg_policies
where schemaname = 'public' and tablename = 'mews_occupancy'
group by tablename;
