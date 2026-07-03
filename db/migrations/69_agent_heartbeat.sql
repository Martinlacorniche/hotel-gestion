-- 69_agent_heartbeat.sql
-- Battement de cœur de l'agent encodeur (PC réception) → voyant « en ligne / hors ligne »
-- sur /serrures pour que les équipes sachent en un coup d'œil si l'encodage est opérationnel.
-- L'agent (service_role) upsert une ligne par hôtel ~toutes les 10 s ; le web lit la fraîcheur.

create table if not exists public.agent_heartbeat (
  hotel_id   uuid primary key references public.hotels(id) on delete cascade,
  last_seen  timestamptz not null default now(),
  encoder_ok boolean not null default false,
  detail     jsonb,
  updated_at timestamptz not null default now()
);

alter table public.agent_heartbeat enable row level security;

-- Lecture pour tous les utilisateurs authentifiés (réception, housekeeping, admin).
-- L'écriture se fait par l'agent avec la clé service_role, qui contourne RLS.
drop policy if exists agent_heartbeat_read on public.agent_heartbeat;
create policy agent_heartbeat_read on public.agent_heartbeat
  for select to authenticated using (true);
