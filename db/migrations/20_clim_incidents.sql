-- ============================================================================
-- Module Clim — Journal d'incidents de climatisation (onglet temporaire Voiles)
-- ============================================================================
-- Une ligne = 1 incident clim observé sur le terrain.
--   space             : chambre ou espace concerné (ex: '24', 'Rooftop', 'Lobby')
--   description        : ce qui s'est passé (texte libre, obligatoire)
--   work_minutes       : temps de travail impliqué, en minutes
--   cost_eur           : coût de réparation / intervention (€)
--   satisfaction_impact: impact ressenti sur la satisfaction client
--                        ('faible' | 'moyen' | 'fort')
--   room_blocked       : la chambre a-t-elle été bloquée (hors service) ?
--   night_price_eur    : prix d'une nuit (manque à gagner) — obligatoire si bloquée
--   nights_blocked     : nombre de nuits bloquées
--   => manque à gagner = night_price_eur * nights_blocked (calculé côté app)
--
-- Onglet temporaire : table simple, pas de cycle de vie (pas de statut).
-- Idempotent. À jouer dans Supabase SQL Editor, puis
-- db/security/14_clim_incidents_rls.sql.
-- ============================================================================

create table if not exists public.clim_incidents (
  id                   uuid primary key default gen_random_uuid(),
  hotel_id             uuid not null references public.hotels(id) on delete cascade,
  occurred_at          timestamptz not null default now(),
  space                text not null,
  description          text not null,
  work_minutes         int not null default 0,
  cost_eur             numeric(10,2) not null default 0,
  satisfaction_impact  text not null default 'faible'
                         check (satisfaction_impact in ('faible','moyen','fort')),
  room_blocked         boolean not null default false,
  night_price_eur      numeric(10,2) not null default 0,
  nights_blocked       int not null default 0,
  photos               text[] not null default '{}',
  created_by           uuid,
  created_by_name      text,
  created_at           timestamptz not null default now()
);

create index if not exists idx_clim_incidents_hotel
  on public.clim_incidents(hotel_id, occurred_at desc);
