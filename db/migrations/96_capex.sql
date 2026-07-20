-- 96 — Suivi CAPEX
--
-- Un CAPEX se suit en DEUX temps, et c'est toute la raison d'être de la table :
-- on inscrit d'abord une enveloppe prévue, puis on constate le réel quand la
-- facture tombe. `montant_reel_ttc` reste donc NULL tant que rien n'est payé —
-- NULL et 0 ne sont PAS la même chose : 0 voudrait dire « payé, gratuit »,
-- alors que NULL dit « pas encore engagé ». Le reste à engager s'appuie
-- là-dessus, ne jamais le remplacer par un défaut à 0.
--
-- Tout est TTC, comme demandé par la direction : c'est le décaissement réel qui
-- intéresse le DAF, pas l'assiette de TVA. Le nom des colonnes le dit, pour
-- qu'aucune saisie HT ne s'y glisse en silence.
--
-- Rattachement au MOIS (annee, mois) et pas à une date : c'est la maille de
-- l'écran Tendance et des `kpis`, et un CAPEX se pilote au mois budgétaire, pas
-- au jour de règlement.

create table if not exists public.capex (
  id                uuid primary key default gen_random_uuid(),
  hotel_id          uuid not null references public.hotels(id) on delete cascade,
  annee             integer not null,
  mois              integer not null check (mois between 1 and 12),
  libelle           text not null,
  montant_prevu_ttc numeric not null,
  montant_reel_ttc  numeric,
  note              text,
  created_at        timestamptz not null default now(),
  created_by        uuid references public.users(id_auth)
);

-- L'écran ouvre toujours sur un couple (hôtel, mois) : c'est l'index qui porte
-- l'usage réel, la clé primaire ne sert qu'à l'édition d'une ligne.
create index if not exists capex_hotel_periode_idx
  on public.capex (hotel_id, annee, mois);

comment on table  public.capex is
  'Investissements : enveloppe prévue puis montant réellement engagé, au mois et par hôtel';
comment on column public.capex.montant_reel_ttc is
  'NULL = pas encore engagé (≠ 0, qui signifierait engagé pour rien). Base du reste à engager.';

alter table public.capex enable row level security;

-- Supabase accorde d'office les privilèges à `anon` sur toute nouvelle table du
-- schéma public. Les policies ci-dessous ne visent que `authenticated`, donc un
-- visiteur non connecté ne verrait rien — mais on ne laisse pas reposer la
-- confidentialité du budget sur ce seul détail : le GRANT part.
revoke all on public.capex from anon;

-- Lecture ouverte aux comptes authentifiés, comme `users` et `kpis` : l'écran
-- CAPEX n'est atteignable que par un admin ou un daf (liste blanche de rôles
-- dans lib/tabs.js côté app), et la donnée n'est pas plus sensible que le CA
-- déjà lisible dans Tendance.
drop policy if exists capex_select_authenticated on public.capex;
create policy capex_select_authenticated on public.capex
  for select to authenticated using (true);

-- Écriture réservée à ceux qui pilotent le budget. Le daf y figure : c'est LUI
-- qui saisit, contrairement au CA restauration où il n'est que lecteur.
drop policy if exists capex_write_admin_daf on public.capex;
create policy capex_write_admin_daf on public.capex
  for all to authenticated
  using      (exists (select 1 from public.users
                      where id_auth = auth.uid() and role in ('admin', 'superadmin', 'daf')))
  with check (exists (select 1 from public.users
                      where id_auth = auth.uid() and role in ('admin', 'superadmin', 'daf')));
