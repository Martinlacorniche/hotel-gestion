-- 92 — Onglets de la barre du bas, choisis par chaque utilisateur (app mobile).
--
-- POURQUOI PAS `pinned_tools` : cette colonne existe déjà mais porte les outils
-- du SITE WEB ('wifi-admin', 'chromecast', 'commercial', 'parking', 'clim'…),
-- qui n'ont pas d'écran mobile. Y ranger les onglets de l'app ferait cohabiter
-- deux vocabulaires dans un seul tableau : impossible de savoir, en lisant
-- {planning, clim}, ce qui s'adresse au web et ce qui s'adresse au mobile. Deux
-- réglages distincts = deux colonnes.
--
-- FORME : tableau ORDONNÉ de clés d'onglets (l'ordre est celui de la barre).
-- Les clés valides sont déclarées dans lib/tabs.js côté app.
--
-- NULL = « je n'ai jamais choisi » → l'app applique la barre par défaut. C'est
-- volontairement différent de '{}' qui signifie « je ne veux AUCUN onglet
-- optionnel » (barre réduite à Planning + Plus). Ne pas mettre de DEFAULT '{}'
-- ici : ça effacerait la distinction et figerait la barre par défaut d'une
-- version de l'app pour toujours.
--
-- Planning et Plus ne figurent JAMAIS dans ce tableau : ils sont fixes.
--   • Planning, parce que c'est le seul écran accessible hors service — le
--     retirer laisserait un employé sans rien.
--   • Plus, parce que c'est la porte d'entrée de tout ce qui n'est pas épinglé.
--     Sans lui, un outil non choisi deviendrait inatteignable.

alter table public.users
  add column if not exists mobile_tabs text[];

comment on column public.users.mobile_tabs is
  'Onglets optionnels de la barre du bas mobile, ordonnés. NULL = barre par défaut. Tableau vide = aucun onglet optionnel. Clés déclarées dans lib/tabs.js. Distinct de pinned_tools, qui porte les outils du site web.';

-- Garde-fou de volume : la barre du bas décroche au-delà de 5 boutons, et 2
-- sont déjà pris par Planning et Plus. Au-delà de 3, l'app devrait trancher
-- silencieusement — autant refuser l'écriture.
alter table public.users
  drop constraint if exists users_mobile_tabs_max;
alter table public.users
  add constraint users_mobile_tabs_max
  check (mobile_tabs is null or cardinality(mobile_tabs) <= 3);
