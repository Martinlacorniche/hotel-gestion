-- Permet la révocation carte-par-carte sans fermer le séjour quand il porte
-- aussi un code ou d'autres cartes. Les cartes sont dérivées des jobs (pas de
-- table dédiée) → on marque ici les numéros de carte révoqués pour les exclure
-- de la liste des clés actives.
ALTER TABLE sejours
  ADD COLUMN IF NOT EXISTS cartes_revoquees text[] NOT NULL DEFAULT '{}';
