-- Groupes & mariages — alerte « date limite atteinte → relâcher l'option dans le PMS ».
-- Marqueur anti-doublon : on n'envoie le mail à l'équipe qu'une seule fois par groupe,
-- au passage de la date_limite. Renseigné par la route /api/groupes/relance-limite.
alter table public.groupes
  add column if not exists alerte_limite_envoyee_at timestamptz;

comment on column public.groupes.alerte_limite_envoyee_at is
  'Horodatage de l''envoi du mail « relâcher l''option » à l''équipe (null = pas encore envoyé). Anti-doublon du cron d''échéance.';
