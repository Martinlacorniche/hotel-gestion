-- Carte « eat & drink » du Rooftop des Voiles — volet FOOD (les boissons restent
-- dans wifi_bar). Concept : on ne sert pas d'alcool sans à manger → chaque boisson
-- s'accompagne d'une assiette à picorer. La donnée est éditée côté équipe dans
-- /wifi-admin (onglet « Plats »), et lue par la vitrine publique (Site-BW) en anon.
-- À coller dans le SQL editor Supabase.

create table if not exists public.rooftop_plats (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references public.hotels(id) on delete cascade,
  section        text not null check (section in ('sale', 'sucre')),
  nom            text not null default '',
  nom_en         text,
  description    text,
  description_en text,
  options        text,                 -- ex. « Sauce au choix : Barbecue ou Mayonnaise »
  options_en     text,
  marque         text,                 -- artisan / marque mise en avant (Aix & Terra, Emkipop…)
  prix           text,                 -- texte libre, nullable (le prix est porté par la boisson)
  vege           boolean not null default false,
  photo_url      text,
  actif          boolean not null default true,
  ordre          int     not null default 0,
  created_at     timestamptz default now()
);

create index if not exists idx_rooftop_plats_hotel
  on public.rooftop_plats (hotel_id, section, ordre);

alter table public.rooftop_plats enable row level security;

-- Lecture : publique (anon + authenticated) — la vitrine Site-BW lit avec la clé
-- anon, exactement comme wifi_bar. On ne filtre pas ici : la vitrine filtre actif=true.
drop policy if exists "rooftop_plats read" on public.rooftop_plats;
create policy "rooftop_plats read" on public.rooftop_plats
  for select to anon, authenticated using (true);

-- Écriture : utilisateur authentifié (le verrou « admin » est appliqué côté UI,
-- comme pour wifi_bar / commercial_tarifs).
drop policy if exists "rooftop_plats write" on public.rooftop_plats;
create policy "rooftop_plats write" on public.rooftop_plats
  for all to authenticated using (true) with check (true);

-- ── Seed initial (Les Voiles) — textes éditables ensuite dans /wifi-admin ──────
insert into public.rooftop_plats (hotel_id, section, nom, description, options, marque, vege, ordre)
values
  ('ded6e6fb-ff3c-4fa8-ad07-403ee316be53', 'sale',
   'Polenta crémeuse & Ribs de bœuf sans os',
   'Polenta crémeuse (100g) et ribs de bœuf fondants sans os (100g), glacés à la sauce Aix & Terra.',
   'Sauce au choix : Barbecue ou Mayonnaise', 'Aix & Terra', false, 0),
  ('ded6e6fb-ff3c-4fa8-ad07-403ee316be53', 'sale',
   'Picanha de veau & compotée de griottes',
   'Picanha de veau grillée (200g) et sa compotée de cerises griottes.',
   null, null, false, 1),
  ('ded6e6fb-ff3c-4fa8-ad07-403ee316be53', 'sale',
   'Planche végétarienne',
   'Légumes de saison, gressins, pains et tartinables Aix & Terra à partager.',
   null, 'Aix & Terra', true, 2),
  ('ded6e6fb-ff3c-4fa8-ad07-403ee316be53', 'sucre',
   'Glaces Emkipop',
   'Glaces artisanales Emkipop, parfums du moment.',
   null, 'Emkipop', false, 0),
  ('ded6e6fb-ff3c-4fa8-ad07-403ee316be53', 'sucre',
   'Soufflé glacé Mangue-Coco',
   'Soufflé glacé onctueux, mangue et noix de coco.',
   null, null, false, 1),
  ('ded6e6fb-ff3c-4fa8-ad07-403ee316be53', 'sucre',
   'Soufflé glacé Caramel',
   'Soufflé glacé au caramel, texture fondante.',
   null, null, false, 2);
