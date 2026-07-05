-- Gestionnaire de mails réception — Phase 2 : câblage des ACTIONS (human-in-the-loop).
-- La Phase 1 CLASSAIT (dry-run). Ici on exécute l'action proposée SUR VALIDATION humaine,
-- catégorie par catégorie, avec un mode réglable par (hôtel, catégorie) :
--   off     -> l'action n'est jamais exécutée (on classe, on n'agit pas)
--   suggest -> l'action attend un clic « Valider » (défaut) = human-in-the-loop
--   auto    -> l'action s'exécute au tri (réservé aux catégories prouvées fiables)
--
-- RLS : verrouillé comme assistant_mail_log → service_role (API route admin) uniquement.

-- 1) Résultat d'exécution sur chaque ligne de journal.
alter table assistant_mail_log
  add column if not exists result       jsonb not null default '{}'::jsonb,  -- {movedTo}|{draftId,webLink}|{note}|…
  add column if not exists action_error text,                                -- message d'erreur si l'exécution a échoué
  add column if not exists decided_by   uuid,                                -- superadmin qui a validé/ignoré
  add column if not exists decided_at   timestamptz;

-- 2) Mode par (hôtel, catégorie). Absence de ligne = défaut 'suggest'.
create table if not exists assistant_mail_config (
  hotel_key  text not null,                    -- 'voiles' | 'corniche'
  category   text not null,                    -- spam_alert|resa_ota|facture|candidature|commercial|client_msg
  mode       text not null default 'suggest',  -- off | suggest | auto
  updated_at timestamptz not null default now(),
  primary key (hotel_key, category)
);

alter table assistant_mail_config enable row level security;
-- Pas de policy volontairement : accès service_role uniquement.
