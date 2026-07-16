-- ============================================================================
-- 89 — Groupes : l'email d'une résa devient facultatif
-- ----------------------------------------------------------------------------
-- POURQUOI (Martin 2026-07-16) : « dans le processus de réservation pro, email &
-- numéro doit pas être obligatoire ». En mode 'pro' (tournage, séminaire), le NOM
-- suffit : la production gère tout, on ne fait pas remplir une fiche client
-- individuelle à 18 comédiens.
--
-- 🐛 Le code a été adapté (formulaire, validation serveur, mail de confirmation
-- envoyé seulement s'il y a une adresse)… mais PAS la base : `email` est resté
-- `not null` depuis la migration 24. Une résa sans email échouait donc à l'insert
-- avec une erreur SQL brute — la fonctionnalité ne marchait pas du tout.
--
-- Trouvé par la passe de cohérence de fin de session, pas par les tests unitaires :
-- même leçon que le code PIN facultatif, qui bloquait dans 4 couches. Rendre un
-- champ facultatif se fait PARTOUT, la base comprise.
--
-- Le téléphone (`tel`) était déjà nullable.
-- ============================================================================

alter table public.groupe_reservations
  alter column email drop not null;

comment on column public.groupe_reservations.email is
  'Email de l''invité. FACULTATIF depuis le mode ''pro'' (le nom suffit). S''il est absent : pas de mail de confirmation, pas de lien magique → la résa se gère par le code PIN (s''il y en a un), sinon par la réception au back-office.';
