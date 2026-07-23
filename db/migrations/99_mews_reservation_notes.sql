-- 99 — Mémoire des notes de réservation écrites par l'assistant dans Mews.
--
-- Depuis le 2026-07-23 l'assistant écrit la note de contrôle DIRECTEMENT dans le
-- PMS (serviceOrderNotes/add), au lieu de la produire pour recopie manuelle.
--
-- Cette table retient l'identifiant de LA note qu'on a créée, par réservation :
-- au passage suivant on la MET À JOUR au lieu d'en empiler une seconde.
--
-- Pourquoi ne pas reconnaître notre note à son texte : l'inventaire des 422 notes
-- réelles montre que l'équipe tape des notes au même format, avec des variantes
-- qu'aucune regex n'attrape de façon fiable (« SGL RGT/P PREMIER SEJOUR »). Se
-- tromper reviendrait à écraser le travail de la réception — l'identifiant est la
-- seule preuve sûre que la note est la nôtre.

create table if not exists public.mews_reservation_notes (
  reservation_id text primary key,          -- ServiceOrderId Mews
  note_id        text not null,             -- ServiceOrderNoteId créé par l'assistant
  hotel_id       uuid references public.hotels(id),
  text           text,                      -- dernier contenu écrit (trace/debug)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.mews_reservation_notes is
  'Note de contrôle écrite par l''assistant dans Mews. La clé est la réservation : une seule note maison par résa, mise à jour et jamais dupliquée.';

alter table public.mews_reservation_notes enable row level security;

-- Écriture réservée au service_role (l''assistant tourne côté serveur) ; lecture
-- ouverte aux utilisateurs authentifiés pour l''affichage dans l''app.
drop policy if exists mews_reservation_notes_read on public.mews_reservation_notes;
create policy mews_reservation_notes_read
  on public.mews_reservation_notes for select
  to authenticated using (true);
