-- ============================================================================
-- Table contrats : contrats datés par salarié (CDI / CDD / Extra / Alternance)
-- ============================================================================
-- Un salarié peut avoir PLUSIEURS contrats (CDD intermittents, etc.).
-- - type : CDI · CDD · Extra · Alternance
-- - date_debut / date_fin (null = en cours / indéterminé)
-- - heures_hebdo : socle contractuel (null pour Extra → payé aux heures faites)
-- - hotel_id : null = vaut pour le groupe (le salarié switche entre hôtels)
--
-- Pilote l'apparition au planning + les heures sup de l'EVP.
-- ============================================================================

create table if not exists public.contrats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id_auth) on delete cascade,
  type text not null check (type in ('CDI', 'CDD', 'Extra', 'Alternance')),
  date_debut date not null,
  date_fin date,
  heures_hebdo numeric,
  hotel_id uuid references public.hotels(id),
  created_at timestamp with time zone not null default now()
);

create index if not exists contrats_user_id_idx on public.contrats (user_id);

-- RLS : modèle Phase 2 du projet (authenticated_all permissif, sécurité côté UI/API).
alter table public.contrats enable row level security;
drop policy if exists "authenticated_all" on public.contrats;
create policy "authenticated_all" on public.contrats
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);
