-- Module Gestion — référentiel produit (conversion achat → conso).
-- Un fournisseur facture dans SON unité (colis, carton, kg…), mais on suit la
-- conso dans NOTRE unité (portion, tasse…). Ce référentiel porte, par produit
-- canonique (produit_ref), l'unité de conso et le facteur de conversion
-- (1 unité d'achat = `facteur` unités de conso). Base de l'inventaire + du
-- coût par portion. À coller dans le SQL editor Supabase (après 57).

create table if not exists public.gestion_produits (
  produit_ref  text primary key,        -- nom canonique (= gestion_achats_lignes.produit_ref)
  poste        text,                     -- override éventuel du poste
  unite_achat  text,                     -- unité facturée (informative, ex. "colis")
  unite_conso  text,                     -- notre unité (ex. "portion")
  facteur      numeric(12,3),            -- 1 unité d'achat = `facteur` unités de conso
  updated_at   timestamptz default now()
);

-- Financier & admin-only : RLS activée SANS policy (accès via /api/gestion, service_role).
alter table public.gestion_produits enable row level security;
