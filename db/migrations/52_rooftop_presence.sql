-- Rooftop — suivi de présence des clients (Les Voiles).
-- On ajoute une colonne `presence` distincte de `statut` (qui reste
-- 'nouvelle'|'confirmee'|'annulee') : côté salle, l'équipe pointe qui est arrivé
-- et qui a posé un lapin. Un no-show bascule le client en blacklist côté UI.
-- À coller dans le SQL editor Supabase (après 51_rooftop_services.sql).

alter table public.rooftop_reservations
  add column if not exists presence text
    check (presence in ('arrive', 'no_show'));

-- null = en attente / pas encore pointé ; 'arrive' = client présent ;
-- 'no_show' = lapin (ajouté aussi à rooftop_blacklist par l'appli).
