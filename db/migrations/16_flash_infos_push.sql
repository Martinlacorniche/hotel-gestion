-- ============================================================================
-- flash_infos : flag `push` pour rendre certains flash silencieux (sans notif)
-- ============================================================================
-- Les nouveautés créées depuis le WEB (pop-up accueil) ne doivent PAS envoyer
-- de notification push mobile (l'edge function send-flash, déclenchée sur
-- INSERT, doit les ignorer). Le mobile (admin.js) continue de pousser (défaut true).
--
-- Additif (défaut true) → pas de fenêtre cassée. À appliquer AVEC la mise à jour
-- de l'edge function send-flash (App-Consignes) qui skip si push = false.
-- ============================================================================

alter table public.flash_infos
  add column if not exists push boolean not null default true;
