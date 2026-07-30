-- Traduction des CATÉGORIES de chambre pour la page publique des groupes.
--
-- La page invité parle FR/EN/ES depuis le 2026-07-30, mais les titres de section
-- (« Classique, Rez de Chaussée », « Confort, étage, vue ville ») viennent de la
-- base et restaient en français au milieu d'une page espagnole — repéré par
-- Martin sur le mariage Maria & Fabien.
--
-- Ces libellés sont saisis par l'hôtel : il faut donc une colonne par langue,
-- comme la carte du Rooftop (rooftop_plats.nom_en). NULL = pas de traduction
-- saisie → la page retombe sur le français.

alter table public.room_types
  add column if not exists nom_en text,
  add column if not exists nom_es text;

comment on column public.room_types.nom_en is
  'Libellé anglais de la catégorie pour la page publique des groupes. NULL → repli sur `nom`.';
comment on column public.room_types.nom_es is
  'Libellé espagnol de la catégorie. NULL → repli sur `nom`.';
