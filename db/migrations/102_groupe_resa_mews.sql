-- 102 — Réservation d'un invité de groupe, créée dans Mews.
--
-- Dernier maillon de la chaîne groupe. Jusqu'ici la réservation d'un invité
-- restait dans notre base avec sa case `pms_done`, que la réception cochait après
-- avoir tout ressaisi dans le PMS. Elle est désormais posée SUR L'ALLOTEMENT du
-- groupe (reservations/add + AvailabilityBlockId), avec sa note de contrôle.
--
-- On mémorise les identifiants Mews : c'est ce qui rend l'opération rejouable
-- sans doublon, et ce qui permettra d'annuler côté PMS si l'invité se désiste.

alter table public.groupe_reservations
  add column if not exists mews_reservation_id text,
  add column if not exists mews_customer_id    text,
  add column if not exists mews_note_id        text;

comment on column public.groupe_reservations.mews_reservation_id is
  'Réservation Mews posée sur l''allotement du groupe. Renseignée = déjà dans le PMS, ne jamais recréer.';
comment on column public.groupe_reservations.mews_customer_id is
  'Profil client créé dans Mews pour cet invité.';
comment on column public.groupe_reservations.mews_note_id is
  'Note de contrôle écrite sur la réservation (serviceOrderNotes).';
