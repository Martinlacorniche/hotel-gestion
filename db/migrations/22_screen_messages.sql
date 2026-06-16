-- ============================================================================
-- Module Écran — Messages vers l'écran SmallTV-Ultra (ESPHome)
-- ============================================================================
-- Une ligne = 1 message à afficher sur l'écran physique posé sur le LAN.
--
-- Architecture (relais Supabase, cf. sondes HACCP) :
--   [Page superadmin /ecran]  --insert (via API route)-->  [cette table]
--                                                              ^
--   [worker Python sur PC LAN] --poll/realtime (service_role)--/
--                              --aioesphomeapi-->  [écran SmallTV]
--
-- Le site (Netlify, cloud) ne peut pas joindre l'écran (LAN) directement :
-- cette table sert de file d'attente + persistance + historique. Le worker
-- côté LAN consomme les messages 'pending', les pousse à l'écran, puis passe
-- la ligne en 'sent' (ou 'failed' + error si l'écran est injoignable).
--
--   text         : texte à afficher (1..200 car. — contrainte RAM ESP8266)
--   duration_sec : durée d'affichage souhaitée, en secondes (1..3600)
--   status       : 'pending' (à envoyer) | 'sent' (affiché) | 'failed' (échec)
--   error        : dernier message d'erreur côté worker (si failed)
--   sent_at      : horodatage de l'envoi effectif à l'écran
--
-- Le worker décide de l'ordre d'affichage : en v1 le message 'pending' le plus
-- récent gagne (les plus anciens sont marqués 'sent' sans réaffichage).
-- Réservé au superadmin (cf. API route + RLS deny).
--
-- Idempotent. À jouer dans Supabase SQL Editor, puis
-- db/security/16_screen_messages_rls.sql.
-- ============================================================================

create table if not exists public.screen_messages (
  id              uuid primary key default gen_random_uuid(),
  text            text not null
                    check (char_length(text) between 1 and 200),
  duration_sec    int not null default 10
                    check (duration_sec between 1 and 3600),
  status          text not null default 'pending'
                    check (status in ('pending', 'sent', 'failed')),
  error           text,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);

-- Le worker récupère les messages à envoyer : index partiel sur les 'pending'.
create index if not exists idx_screen_messages_pending
  on public.screen_messages(created_at desc)
  where status = 'pending';

-- Historique récent affiché dans la page.
create index if not exists idx_screen_messages_recent
  on public.screen_messages(created_at desc);
