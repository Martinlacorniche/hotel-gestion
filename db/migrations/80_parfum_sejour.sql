-- 80 — Parfums : passage au modèle « séjour » (la réservation est le programme).
-- La réception saisit un thème + un nombre de nuits ; l'agent génère un planning
-- auto-porté (accueil au check-in → ambiance matin+soir → arrêt au départ 12h).
-- Voir scent-control/aromalink/consigne.py : stay_schedule(theme, checkin, checkout).

-- Durée du séjour en nuits (départ = check-in + nuits, à 12h00). Null pour les
-- modes historiques (ambiance/boost/off) qui restent supportés.
alter table public.consignes_parfum
  add column if not exists nuits int check (nuits is null or nuits between 1 and 60);

-- Nouveau mode 'sejour' (un seul envoi couvre tout le séjour + l'arrêt au départ).
alter table public.consignes_parfum drop constraint if exists consignes_parfum_mode_check;
alter table public.consignes_parfum
  add constraint consignes_parfum_mode_check
  check (mode in ('ambiance','boost','off','sejour'));
