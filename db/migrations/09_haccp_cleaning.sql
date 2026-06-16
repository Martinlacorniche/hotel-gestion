-- ============================================================================
-- Module HACCP — Pilier 4 : Plan de nettoyage et désinfection
-- ============================================================================
-- Tables créées :
--   haccp_cleaning_zones : zones d'un hôtel (cuisine, buffet, plonge, sanitaires…)
--   haccp_cleaning_tasks : tâches récurrentes dans une zone (fréquence, produit, durée, instructions)
--   haccp_cleaning_logs  : validations effectives (qui a fait quoi, quand)
--
-- Modèle de fenêtre :
--   - daily     : 1 fenêtre par jour       → period_key = date du jour
--   - weekly    : 1 fenêtre par semaine    → period_key = lundi de la semaine ISO
--   - monthly   : 1 fenêtre par mois       → period_key = 1er du mois
--   - quarterly : 1 fenêtre par trimestre  → period_key = 1er du trimestre
--
-- Une tâche est "faite" pour la fenêtre courante s'il existe un log
-- avec period_key correspondant. Tout est libre dans la fenêtre (pas
-- de jour précis imposé).
--
-- Idempotent. À jouer dans Supabase SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) haccp_cleaning_zones — zones par hôtel
-- ----------------------------------------------------------------------------
create table if not exists public.haccp_cleaning_zones (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  name        text not null,                          -- "Cuisine", "Buffet", "Plonge"…
  icon        text,                                   -- emoji libre (ex: "🧽", "🧴")
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_haccp_cleaning_zones_hotel
  on public.haccp_cleaning_zones(hotel_id, sort_order)
  where active = true;

drop trigger if exists trg_haccp_cleaning_zones_set_updated_at on public.haccp_cleaning_zones;
create trigger trg_haccp_cleaning_zones_set_updated_at
  before update on public.haccp_cleaning_zones
  for each row execute function public.haccp_set_updated_at();

-- ----------------------------------------------------------------------------
-- 2) haccp_cleaning_tasks — tâches récurrentes
-- ----------------------------------------------------------------------------
create table if not exists public.haccp_cleaning_tasks (
  id             uuid primary key default gen_random_uuid(),
  zone_id        uuid not null references public.haccp_cleaning_zones(id) on delete cascade,
  name           text not null,                       -- "Nettoyer plan de travail", "Détartrer cafetière"
  frequency      text not null check (frequency in ('daily', 'weekly', 'monthly', 'quarterly')),
  product        text,                                -- "Détergent désinfectant Sani-Quat" (texte libre)
  instructions   text,                                -- pas-à-pas court
  estimated_min  int,                                 -- durée estimée en minutes
  assigned_role  text,                                -- 'user' / 'admin' / null (libre)
  sort_order     int not null default 0,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_haccp_cleaning_tasks_zone
  on public.haccp_cleaning_tasks(zone_id, sort_order)
  where active = true;

create index if not exists idx_haccp_cleaning_tasks_frequency
  on public.haccp_cleaning_tasks(frequency)
  where active = true;

drop trigger if exists trg_haccp_cleaning_tasks_set_updated_at on public.haccp_cleaning_tasks;
create trigger trg_haccp_cleaning_tasks_set_updated_at
  before update on public.haccp_cleaning_tasks
  for each row execute function public.haccp_set_updated_at();

-- ----------------------------------------------------------------------------
-- 3) haccp_cleaning_logs — validations terrain
-- ----------------------------------------------------------------------------
-- period_key = clé de la fenêtre couverte par cette exécution :
--   daily      → la date elle-même (ex: 2026-05-27)
--   weekly     → le lundi de la semaine ISO de done_at
--   monthly    → le 1er du mois de done_at
--   quarterly  → le 1er du trimestre de done_at (1er jan / 1er avr / 1er juil / 1er oct)
--
-- L'unique (task_id, period_key) garantit qu'une tâche n'est validée qu'une
-- fois par fenêtre (un 2e tap ne crée pas de doublon ; il ré-écrit/refuse).
create table if not exists public.haccp_cleaning_logs (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.haccp_cleaning_tasks(id) on delete cascade,
  hotel_id    uuid not null references public.hotels(id) on delete cascade,  -- dénormalisé pour filtre rapide multi-hôtel
  done_by     uuid,                                                          -- auth.uid() du valideur
  done_by_name text,                                                          -- snapshot nom (rétro-compat si user supprimé)
  done_at     timestamptz not null default now(),
  period_key  date not null,
  notes       text
);

create unique index if not exists uq_haccp_cleaning_logs_task_period
  on public.haccp_cleaning_logs(task_id, period_key);

create index if not exists idx_haccp_cleaning_logs_hotel_period
  on public.haccp_cleaning_logs(hotel_id, period_key desc);

create index if not exists idx_haccp_cleaning_logs_done_at
  on public.haccp_cleaning_logs(hotel_id, done_at desc);

-- ----------------------------------------------------------------------------
-- 4) Helper : calcul de la period_key d'une date selon la fréquence
-- ----------------------------------------------------------------------------
-- Utilisable côté SQL pour reporting / debug. Le code applicatif (TS) calcule
-- aussi cette clé avant insertion pour rester déterministe.
create or replace function public.haccp_cleaning_period_key(
  p_frequency text,
  p_at        timestamptz default now()
) returns date
language sql
immutable
as $$
  select case p_frequency
    when 'daily'     then (p_at at time zone 'Europe/Paris')::date
    when 'weekly'    then date_trunc('week',    p_at at time zone 'Europe/Paris')::date
    when 'monthly'   then date_trunc('month',   p_at at time zone 'Europe/Paris')::date
    when 'quarterly' then date_trunc('quarter', p_at at time zone 'Europe/Paris')::date
  end
$$;

-- ----------------------------------------------------------------------------
-- 5) Vérification finale
-- ----------------------------------------------------------------------------
select
  table_name,
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = t.table_name) as nb_columns
from (values
  ('haccp_cleaning_zones'),
  ('haccp_cleaning_tasks'),
  ('haccp_cleaning_logs')
) as t(table_name)
order by table_name;
