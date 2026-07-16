-- ============================================================================
-- 87 — Hôtels : adresse et téléphone (les coordonnées n'existaient nulle part)
-- ----------------------------------------------------------------------------
-- POURQUOI (Martin 2026-07-16) : « le mail de conf, pas ouf, on voit pas qu'on est
-- à Toulon ». Le mail de confirmation d'une résa de groupe annonce « Chambre
-- réservée · CACTUS FILMS · Ch. 06 » sans jamais dire DANS QUEL HÔTEL ni OÙ. Un
-- comédien belge le reçoit et ne sait pas qu'il dort au Best Western Plus La
-- Corniche, à Toulon.
--
-- Cause racine : la table `hotels` ne porte AUCUNE coordonnée. Elle a `nom`, des
-- champs de facturation (`adresse_facturation`, renseignée pour Les Voiles
-- seulement), mais ni adresse d'accueil, ni téléphone. L'adresse des Voiles est
-- d'ailleurs CODÉE EN DUR dans la vitrine (`api/rooftop-reservation/route.ts`).
--
-- On met l'info à la source : tout ce qui parle au client (mails de groupe, de
-- rooftop, devis, PDF) doit pouvoir la lire, sans la recopier.
-- ============================================================================

alter table public.hotels
  add column if not exists adresse    text,
  add column if not exists telephone  text;

comment on column public.hotels.adresse is
  'Adresse d''accueil (rue, code postal, ville) — celle qu''on donne au client. Distincte de adresse_facturation (entité juridique).';
comment on column public.hotels.telephone is
  'Téléphone de la réception, affiché aux clients dans les mails.';

-- La Corniche : adresse relevée sur un vrai courrier (avis de livraison DPD du
-- 15/07/2026 : « LA CORNICHE BEST WESTERN, 17 ALL FREDERIC MISTRAL, F-83000 TOULON »).
-- Téléphone donné par Martin le 2026-07-16 (je l'avais laissé vide plutôt que de
-- l'inventer : un faux numéro dans un mail client est pire que pas de numéro).
update public.hotels set
  adresse   = coalesce(adresse, '17 allée Frédéric Mistral, 83000 Toulon'),
  telephone = coalesce(telephone, '04 94 41 35 12')
where nom = 'La Corniche';

-- Les Voiles : les deux étaient codés en dur dans la vitrine
-- (`api/rooftop-reservation/route.ts`) → on les remonte à la source.
update public.hotels set
  adresse   = coalesce(adresse, '124 rue Gubler, 83000 Toulon'),
  telephone = coalesce(telephone, '04 94 41 36 23')
where nom = 'Les Voiles';
