-- ============================================================================
-- Module Maintenance — Entretien récurrent (arrosage, sel adoucisseur, suie…)
-- ============================================================================
-- Besoin : « 1 clic = c'est fait », et à côté la fréquence réelle (tous les
-- combien on arrose / on met un sac de sel / on vide le bac à suie).
--
-- Plutôt qu'un onglet par tâche (3 aujourd'hui, 6 demain), deux tables :
--   entretien_taches      = le catalogue, éditable par les admins par hôtel
--   entretien_evenements  = un clic = une ligne (date + quantité + qui)
-- Les stats (dernier passage, rythme moyen, total 30 j / 12 mois) se calculent
-- côté app à partir des événements — rien à maintenir en base.
--
-- Idempotent.  À jouer avec :
--   node scripts/sql.mjs -f db/migrations/100_entretien_recurrent.sql
--   node scripts/sql.mjs -f db/security/23_entretien_rls.sql
-- ============================================================================

create table if not exists public.entretien_taches (
  id                     uuid primary key default gen_random_uuid(),
  hotel_id               uuid not null references public.hotels(id) on delete cascade,
  code                   text not null,                     -- slug stable (arrosage, sel, suie…)
  label                  text not null,                     -- « Arrosage des fleurs »
  verbe                  text not null default 'Fait',      -- libellé du bouton : « Arrosé »
  unite_singulier        text not null default 'passage',   -- « arrosage », « sac », « bac »
  unite_pluriel          text not null default 'passages',
  icone                  text not null default 'droplets',
  couleur                text not null default 'sky',
  frequence_cible_jours  int,                               -- rythme visé (null = juste observer)
  actif                  boolean not null default true,
  sort_order             int not null default 0,
  created_at             timestamptz not null default now(),
  unique (hotel_id, code)
);

create table if not exists public.entretien_evenements (
  id          uuid primary key default gen_random_uuid(),
  tache_id    uuid not null references public.entretien_taches(id) on delete cascade,
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  date_event  date not null default current_date,
  quantite    numeric not null default 1,
  auteur      text,
  auteur_id   uuid,
  commentaire text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_entretien_taches_hotel
  on public.entretien_taches(hotel_id, sort_order);

create index if not exists idx_entretien_evts_tache
  on public.entretien_evenements(tache_id, date_event desc);

create index if not exists idx_entretien_evts_hotel
  on public.entretien_evenements(hotel_id, date_event desc);

-- ----------------------------------------------------------------------------
-- Seed La Corniche : les 3 tâches demandées par la direction
-- ----------------------------------------------------------------------------
do $$
declare
  v_hotel_id uuid;
begin
  select id into v_hotel_id from public.hotels where nom ilike '%corniche%' limit 1;

  if v_hotel_id is null then
    raise notice 'Hôtel La Corniche introuvable — seed ignoré';
    return;
  end if;

  insert into public.entretien_taches
    (hotel_id, code, label, verbe, unite_singulier, unite_pluriel, icone, couleur, frequence_cible_jours, sort_order)
  values
    (v_hotel_id, 'arrosage', 'Arrosage des fleurs', 'Arrosé',   'arrosage', 'arrosages', 'flower',  'emerald', 3,    1),
    (v_hotel_id, 'sel',      'Sel adoucisseur',     'Sac versé','sac',      'sacs',      'package', 'sky',     null, 2),
    (v_hotel_id, 'suie',     'Bac à suie',          'Bac vidé', 'bac',      'bacs',      'flame',   'amber',   null, 3)
  on conflict (hotel_id, code) do nothing;
end $$;

select t.code, t.label, h.nom
from public.entretien_taches t join public.hotels h on h.id = t.hotel_id
order by h.nom, t.sort_order;
