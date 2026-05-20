-- Pass équipes : cartes longue durée (1 an par défaut) ouvrant TOUTES les chambres.
-- Volontairement séparé de `sejours` pour que les pass n'apparaissent pas dans la
-- liste des clefs/chambres et ne bloquent aucune chambre comme "occupée".

create table if not exists public.passes (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  label       text,
  debut       timestamptz not null,
  fin         timestamptz not null,
  statut      text not null default 'actif',          -- 'actif' | 'archive'
  last_job_id uuid references public.jobs_encodeur(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists passes_hotel_id_idx on public.passes(hotel_id);
create index if not exists passes_created_at_idx on public.passes(created_at desc);

-- Un job d'encodage de pass n'est lié à aucun séjour : sejour_id doit être nullable.
alter table public.jobs_encodeur alter column sejour_id drop not null;
