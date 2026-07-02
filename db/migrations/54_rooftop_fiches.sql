-- Fiches techniques du Rooftop (Les Voiles) — usage INTERNE équipe :
-- composition + grammages + montage pour aider le service/cuisine, et coûts
-- matière + grille de marges par catégorie de boisson pour le pilotage.
-- Contrairement à rooftop_plats (lu en anon par la vitrine publique), ces
-- données sont sensibles (coûts, marges) → lecture réservée aux authentifiés.
-- Édité dans /rooftop (onglet « Fiches »). À coller dans le SQL editor Supabase.

-- ── Fiches (assiettes + desserts) ──────────────────────────────────────────
create table if not exists public.rooftop_fiches (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid not null references public.hotels(id) on delete cascade,
  categorie    text not null default 'assiette' check (categorie in ('assiette', 'dessert')),
  nom          text not null default '',
  sous_titre   text,
  cout         numeric(6,2),                 -- coût matière HT €, nullable
  ingredients  jsonb not null default '[]'::jsonb,  -- [{label, qty, note}]
  montage      jsonb not null default '[]'::jsonb,  -- ["étape 1", "étape 2", …]
  actif        boolean not null default true,
  ordre        int     not null default 0,
  created_at   timestamptz default now()
);

create index if not exists idx_rooftop_fiches_hotel
  on public.rooftop_fiches (hotel_id, categorie, ordre);

alter table public.rooftop_fiches enable row level security;

-- Lecture + écriture : authentifiés uniquement (données sensibles, pas de vitrine).
drop policy if exists "rooftop_fiches read" on public.rooftop_fiches;
create policy "rooftop_fiches read" on public.rooftop_fiches
  for select to authenticated using (true);
drop policy if exists "rooftop_fiches write" on public.rooftop_fiches;
create policy "rooftop_fiches write" on public.rooftop_fiches
  for all to authenticated using (true) with check (true);

-- ── Marges (prix par catégorie de boisson, assiette au choix incluse) ───────
create table if not exists public.rooftop_marges (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  categorie   text not null default '',   -- ex. « Soft (café/thé/jus/soda) »
  prix        text,                        -- prix TTC tout compris, ex. « 11 € »
  marge_min   text,                        -- marge € pire cas (assiette la + chère)
  marge_max   text,                        -- marge € meilleur cas (assiette la - chère)
  ordre       int not null default 0,
  created_at  timestamptz default now()
);

create index if not exists idx_rooftop_marges_hotel
  on public.rooftop_marges (hotel_id, ordre);

alter table public.rooftop_marges enable row level security;

drop policy if exists "rooftop_marges read" on public.rooftop_marges;
create policy "rooftop_marges read" on public.rooftop_marges
  for select to authenticated using (true);
drop policy if exists "rooftop_marges write" on public.rooftop_marges;
create policy "rooftop_marges write" on public.rooftop_marges
  for all to authenticated using (true) with check (true);

-- ── Seed (Les Voiles) — éditable ensuite dans l'app ─────────────────────────
insert into public.rooftop_fiches (hotel_id, categorie, nom, sous_titre, cout, ingredients, montage, ordre)
values
  ('ded6e6fb-ff3c-4fa8-ad07-403ee316be53', 'assiette',
   'Ribs & Polenta', 'Ribs de bœuf sans os, polenta crémeuse', 4.41,
   '[{"label":"Ribs de bœuf sans os","qty":"1 portion","note":"à régénérer"},{"label":"Palet de polenta crémeuse","qty":"1 palet","note":"à régénérer"},{"label":"Sauce au choix — barbecue ou mayonnaise","qty":"30 g","note":""},{"label":"Pain (baguette)","qty":"¼ baguette","note":""},{"label":"Déco (herbes / zeste) + serviette","qty":"—","note":""}]'::jsonb,
   '["Régénérer le ribs et le palet de polenta selon la fiche fournisseur.","Dresser la polenta, poser le ribs par-dessus.","Ajouter un point de sauce au choix du client (barbecue ou mayo), 30 g.","¼ de baguette + touche de déco. Servir chaud."]'::jsonb,
   0),
  ('ded6e6fb-ff3c-4fa8-ad07-403ee316be53', 'assiette',
   'Picanha', 'Picanha de veau 150 g, compotée griottes', 5.89,
   '[{"label":"Picanha de veau","qty":"150 g","note":"snacker / trancher"},{"label":"Compotée de cerise griottes","qty":"30 g","note":"en quenelle"},{"label":"Sauce au choix — barbecue ou mayonnaise","qty":"30 g","note":""},{"label":"Feuilles de salade","qty":"quelques","note":"en déco / lit"},{"label":"Pain (baguette)","qty":"¼ baguette","note":""}]'::jsonb,
   '["Régénérer / snacker la picanha (150 g), laisser reposer puis trancher.","Dresser sur un lit de quelques feuilles de salade.","Quenelle de compotée de cerise griottes (30 g) sur le côté.","Point de sauce au choix (30 g) + ¼ de baguette."]'::jsonb,
   1),
  ('ded6e6fb-ff3c-4fa8-ad07-403ee316be53', 'assiette',
   'Planche végé', 'Tartinable Aix & Terra, crudités, gressins', 3.36,
   '[{"label":"Tartinable Aix & Terra au choix","qty":"60 g","note":"poivronade / courgettes / sardinade"},{"label":"Crudités de saison","qty":"~180 g","note":"taillées en bâtonnets"},{"label":"Gressins","qty":"~4 pièces","note":""},{"label":"Serviette","qty":"—","note":""}]'::jsonb,
   '["Belle quenelle de tartinable au choix (60 g).","Crudités taillées en bâtonnets (~180 g), dressage soigné.","Ajouter les gressins (~4).","Servir frais."]'::jsonb,
   2),
  ('ded6e6fb-ff3c-4fa8-ad07-403ee316be53', 'dessert',
   'Soufflé caramel', 'Régénérer · sucre glace + menthe', 3.10, '[]'::jsonb, '[]'::jsonb, 0),
  ('ded6e6fb-ff3c-4fa8-ad07-403ee316be53', 'dessert',
   'Soufflé mango coco', 'Régénérer · sucre glace + menthe', 2.93, '[]'::jsonb, '[]'::jsonb, 1),
  ('ded6e6fb-ff3c-4fa8-ad07-403ee316be53', 'dessert',
   'Glace Emkipop (bâtonnet)', 'Servi tel quel · 1,72–1,82 € selon parfum', null, '[]'::jsonb, '[]'::jsonb, 2);

insert into public.rooftop_marges (hotel_id, categorie, prix, marge_min, marge_max, ordre)
values
  ('ded6e6fb-ff3c-4fa8-ad07-403ee316be53', 'Soft (café/thé/jus/soda)', '11 €', '2,74 €', '5,27 €', 0),
  ('ded6e6fb-ff3c-4fa8-ad07-403ee316be53', 'Vins (verre)',             '13 €', '4,63 €', '7,16 €', 1),
  ('ded6e6fb-ff3c-4fa8-ad07-403ee316be53', 'Bières',                   '14 €', '4,84 €', '7,37 €', 2),
  ('ded6e6fb-ff3c-4fa8-ad07-403ee316be53', 'Cocktails',                '16 €', '6,46 €', '8,99 €', 3);
