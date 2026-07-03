-- Cache Mews : ajoute le REVENU (CA total + hébergement + prix moyen) à côté de
-- l'occupation. Rempli par /api/mews/refresh-occupancy (cron ~3 h), Les Voiles
-- uniquement. Alimente le widget Performance du dashboard (CA / prix moyen live).
-- À coller dans le SQL editor Supabase (après 65_rooftop_paiements.sql).
--
-- Règle (validée exploitant, TTC) : CA = Σ GrossValue des orderItems non annulés ;
-- hébergement = Type ∈ {SpaceOrder, CancellationFee} (chambres + no-show/annul) ;
-- prix moyen = hébergement TTC ÷ nuitées occupées.

alter table public.mews_occupancy
  add column if not exists ca_ttc     numeric(12,2),  -- CA total TTC (chambres + F&B + extras)
  add column if not exists heberg_ttc numeric(12,2),  -- revenu hébergement TTC (base du prix moyen)
  add column if not exists prix_moyen numeric(10,2);  -- prix moyen chambre (ADR)
