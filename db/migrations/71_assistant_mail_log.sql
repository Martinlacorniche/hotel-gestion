-- Gestionnaire de mails réception (Voiles + Corniche) — Phase 1.
-- Journal : chaque mail traité = une ligne (classification + action proposée + statut).
-- En Phase 1 tout est en DRY-RUN (dry_run=true) : l'assistant CLASSE et JOURNALISE
-- sans rien supprimer ni envoyer. Les actions seront câblées catégorie par catégorie,
-- avec passage en auto une fois la catégorie prouvée fiable.
--
-- RLS : verrouillé (aucune policy) → seul le service_role (cron / API route) accède.
-- La future page réception lira via une API route admin (requireRole), pas en direct.

create table if not exists assistant_mail_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  mailbox text not null,                          -- contact-lesvoiles@htbm.fr | contact-corniche@htbm.fr
  message_id text not null,                       -- id Microsoft Graph
  from_addr text,
  from_name text,
  subject text,
  received_at timestamptz,
  category text not null default 'autre',         -- spam_alert|resa_ota|facture|candidature|commercial|client_msg|autre
  proposed_action text not null default 'none',   -- delete|resa_control|route_pennylane|draft_reply|commercial_followup|none
  reason text,                                    -- pourquoi cette classification (traçabilité)
  detail jsonb not null default '{}'::jsonb,       -- données extraites (champs résa, entité facture, etc.)
  status text not null default 'proposed',        -- proposed|validated|executed|skipped
  dry_run boolean not null default true,
  processed_at timestamptz,
  unique (mailbox, message_id)
);

create index if not exists idx_assistant_mail_log_created on assistant_mail_log (created_at desc);
create index if not exists idx_assistant_mail_log_status  on assistant_mail_log (status);

alter table assistant_mail_log enable row level security;
-- Pas de policy volontairement : accès service_role uniquement.
