-- ============================================================================
-- Module HACCP — Bibliothèque documents
-- ============================================================================
-- Stockage des documents administratifs HACCP (PMS, formations, contrats,
-- FT/FDS, rapports nuisibles, maintenance, etc.) avec versioning et expiration.
--
-- Le fichier physique est dans le bucket Supabase Storage 'haccp-documents'
-- (privé). Cette table stocke les métadonnées et le storage_path.
--
-- ⚠️ Avant de jouer cette migration, créer le bucket dans Supabase :
--   Dashboard → Storage → New bucket
--     Name : haccp-documents
--     Public : NON
--     File size limit : 10 MB
--     Allowed MIME types : application/pdf (+ optionnellement image/png, image/jpeg)
--
-- Idempotent. À jouer dans Supabase SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) haccp_documents — bibliothèque administrative
-- ----------------------------------------------------------------------------
create table if not exists public.haccp_documents (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references public.hotels(id) on delete cascade,
  category      text not null,                              -- voir CHECK ci-dessous
  name          text not null,                              -- libellé humain ("Formation HACCP - Marie D.")
  filename      text not null,                              -- nom de fichier original (preuve, audit)
  storage_path  text not null,                              -- path dans le bucket haccp-documents
  mime_type     text,                                       -- 'application/pdf', 'image/png', etc.
  file_size     int,                                        -- octets
  valid_until   date,                                       -- date d'expiration (null = pas d'expiration)
  version       int not null default 1,                     -- incrément à chaque remplacement
  notes         text,
  uploaded_by   uuid,                                       -- auth.uid() de l'uploader
  created_at    timestamptz not null default now(),
  replaced_at   timestamptz                                 -- si une nouvelle version a été uploadée
);

-- Catégories autorisées — extensible dans le futur en relâchant cette contrainte
alter table public.haccp_documents drop constraint if exists haccp_documents_category_check;
alter table public.haccp_documents
  add constraint haccp_documents_category_check
  check (category in (
    'pms',                      -- Plan de Maîtrise Sanitaire
    'formation_haccp',          -- Certificat formation personnel
    'contrat_nuisibles',        -- Contrat société extérieure
    'rapport_nuisibles',        -- Rapports d'intervention
    'ft_produit_menage',        -- Fiche technique produit
    'fds_produit_menage',       -- Fiche données sécurité (FDS - obligatoire)
    'maintenance_equipement',   -- Carnet maintenance frigo/four/lave-vaisselle
    'etalonnage_thermometre',   -- Attestation étalonnage (si thermo de référence)
    'eau_potable',              -- Analyse eau si applicable
    'attestation_fournisseur',  -- Agrément fournisseur
    'autre'                     -- Catch-all
  ));

create index if not exists idx_haccp_documents_hotel_category
  on public.haccp_documents(hotel_id, category);

create index if not exists idx_haccp_documents_active
  on public.haccp_documents(hotel_id, valid_until) where replaced_at is null;

create index if not exists idx_haccp_documents_expiring
  on public.haccp_documents(valid_until) where replaced_at is null and valid_until is not null;

-- ----------------------------------------------------------------------------
-- 2) Vérification finale
-- ----------------------------------------------------------------------------
select
  column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'haccp_documents'
order by ordinal_position;
