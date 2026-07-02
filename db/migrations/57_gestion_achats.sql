-- Module Gestion — suivi des ACHATS par poste (La Corniche, Pennylane + Claude).
-- Les factures fournisseurs ciblées (PDJ / Cowork / Resto) sont lues via Pennylane,
-- leur PDF extrait par Claude (produit, quantité, prix), et stocké ici pour le
-- cockpit admin (achats/conso par poste + ratios ÷ CA saisi à la main).
-- Financier & admin-only : RLS activée SANS policy → accès uniquement via les
-- routes /api/gestion (service_role). À coller dans le SQL editor Supabase.

-- ── Factures (une par facture fournisseur) ───────────────────────────────────
create table if not exists public.gestion_achats (
  id                 uuid primary key default gen_random_uuid(),
  pennylane_id       bigint unique,               -- id Pennylane (anti-doublon)
  invoice_number     text,
  fournisseur        text,
  poste              text,                        -- 'pdj' | 'cowork' | 'resto'
  is_avoir           boolean not null default false,
  date_facture       date,
  mois_rattachement  text,                        -- 'YYYY-MM' (règle jour>=25 → mois suivant, éditable)
  total_ht           numeric(12,2) not null default 0,
  extracted_at       timestamptz default now(),
  created_at         timestamptz default now()
);

create index if not exists idx_gestion_achats_mois on public.gestion_achats (mois_rattachement, poste);

-- ── Lignes d'articles (extraction Claude) ────────────────────────────────────
create table if not exists public.gestion_achats_lignes (
  id             uuid primary key default gen_random_uuid(),
  achat_id       uuid not null references public.gestion_achats(id) on delete cascade,
  produit        text not null,                   -- libellé tel quel sur la facture
  produit_ref    text,                            -- nom canonique normalisé (suivi de prix dans le temps)
  quantite       numeric(12,3) not null default 0,
  unite          text,
  prix_unitaire  numeric(12,4) not null default 0,
  montant_ht     numeric(12,2) not null default 0,
  hors_poste     boolean not null default false,  -- ligne qui ne relève pas du poste (frais de port…)
  poste          text
);

create index if not exists idx_gestion_lignes_achat on public.gestion_achats_lignes (achat_id);
create index if not exists idx_gestion_lignes_ref on public.gestion_achats_lignes (produit_ref);

-- ── Revenus saisis à la main (CA par mois & poste, pour les ratios) ──────────
create table if not exists public.gestion_revenus (
  id          uuid primary key default gen_random_uuid(),
  mois        text not null,                      -- 'YYYY-MM'
  poste       text not null,                      -- 'pdj' | 'cowork' | 'resto'
  ca_ht       numeric(12,2) not null default 0,
  quantite    numeric(12,2),                      -- ex. nb couverts PDJ (optionnel)
  updated_at  timestamptz default now(),
  unique (mois, poste)
);

-- ── RLS : activée SANS policy → seul le service_role (routes /api/gestion) accède
alter table public.gestion_achats        enable row level security;
alter table public.gestion_achats_lignes enable row level security;
alter table public.gestion_revenus       enable row level security;
