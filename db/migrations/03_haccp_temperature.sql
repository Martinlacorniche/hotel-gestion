-- ============================================================================
-- Module HACCP — Phase 1 : Suivi des températures (sondes Zigbee)
-- ============================================================================
-- Tables créées :
--   haccp_sensors  : config des sondes physiques (1 par emplacement)
--   haccp_readings : relevés bruts ingérés depuis MQTT (gros volume)
--   haccp_alerts   : dépassements de seuil détectés (avec acquittement)
--
-- POC La Corniche : 7 sondes (3 congélateurs + 4 frigos), voir doc :
--   docs/haccp/README.md
--
-- Idempotent. À jouer dans Supabase SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Fonction utilitaire : trigger updated_at (réutilisable)
-- ----------------------------------------------------------------------------
create or replace function public.haccp_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1) haccp_sensors — config des sondes
-- ----------------------------------------------------------------------------
create table if not exists public.haccp_sensors (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references public.hotels(id) on delete cascade,
  zigbee_address  text unique not null,                       -- IEEE renvoyée par Z2M (ex: 0x00158d0001234567)
  friendly_name   text not null,                              -- nom court Z2M (ex: "frigo_gauche")
  location        text not null,                              -- humain ("Cuisine - Frigo Gauche")
  sensor_type     text not null check (sensor_type in ('negatif', 'positif', 'ambient')),
  temp_min        numeric,                                    -- seuil bas (null = pas d'alerte basse, cas congel)
  temp_max        numeric,                                    -- seuil haut
  alert_delay_min int not null default 30,                    -- minutes au-dessus du seuil avant alerte (anti faux positifs ouverture porte)
  active          boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_haccp_sensors_hotel on public.haccp_sensors(hotel_id);
create index if not exists idx_haccp_sensors_active on public.haccp_sensors(hotel_id) where active = true;

drop trigger if exists trg_haccp_sensors_set_updated_at on public.haccp_sensors;
create trigger trg_haccp_sensors_set_updated_at
  before update on public.haccp_sensors
  for each row execute function public.haccp_set_updated_at();

-- ----------------------------------------------------------------------------
-- 2) haccp_readings — relevés bruts ingérés depuis MQTT
-- ----------------------------------------------------------------------------
-- Volume : ~1 relevé toutes les 1-5 min × 7 sondes × 24h = ~2 000-10 000 lignes/jour/hôtel.
-- Index sur (sensor_id, recorded_at desc) obligatoire pour les requêtes dashboard
-- et la génération PDF mensuelle.
create table if not exists public.haccp_readings (
  id          bigserial primary key,
  sensor_id   uuid not null references public.haccp_sensors(id) on delete cascade,
  temperature numeric not null,
  humidity    numeric,
  battery     int,                                          -- pourcentage 0-100
  rssi        int,                                          -- signal Zigbee (qualité radio)
  recorded_at timestamptz not null default now()
);

create index if not exists idx_haccp_readings_sensor_time
  on public.haccp_readings(sensor_id, recorded_at desc);

-- ----------------------------------------------------------------------------
-- 3) haccp_alerts — dépassements de seuil détectés
-- ----------------------------------------------------------------------------
-- Workflow :
--   triggered (créé par worker quand T° dépasse seuil > alert_delay_min)
--     → acknowledged (optionnel : user clique "Vu" + action corrective)
--     → resolved (auto par worker quand T° revient sous seuil)
create table if not exists public.haccp_alerts (
  id                uuid primary key default gen_random_uuid(),
  sensor_id         uuid not null references public.haccp_sensors(id) on delete cascade,
  threshold_type    text not null check (threshold_type in ('high', 'low')),
  triggered_at      timestamptz not null default now(),
  resolved_at       timestamptz,
  peak_value        numeric not null,                       -- T° max (high) ou min (low) atteinte pendant l'alerte
  acknowledged_by   uuid,                                   -- auth.uid() de l'utilisateur qui a acquitté
  acknowledged_at   timestamptz,
  action_taken      text                                    -- description action corrective saisie au moment de l'acquittement
);

create index if not exists idx_haccp_alerts_sensor_triggered
  on public.haccp_alerts(sensor_id, triggered_at desc);
create index if not exists idx_haccp_alerts_unresolved
  on public.haccp_alerts(triggered_at desc) where resolved_at is null;

-- ----------------------------------------------------------------------------
-- 4) Vérification finale
-- ----------------------------------------------------------------------------
select
  table_name,
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = t.table_name) as nb_columns
from (values
  ('haccp_sensors'),
  ('haccp_readings'),
  ('haccp_alerts')
) as t(table_name)
order by table_name;
