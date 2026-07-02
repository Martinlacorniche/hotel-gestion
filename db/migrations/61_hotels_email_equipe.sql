-- Adresse mail de l'équipe par hôtel (réception / exploitation).
-- Source unique pour les alertes internes (ex. « libérer l'option » des groupes),
-- éditable sans redéploiement et partagée avec les autres apps (même base).
-- Repli si null : variables d'env TEAM_EMAIL_* puis GROUPES_ALERT_EMAIL.
alter table public.hotels
  add column if not exists email_equipe text;

comment on column public.hotels.email_equipe is
  'Adresse mail de l''équipe de l''hôtel (alertes internes, ex. libération d''option groupes). Null = repli sur variables d''env.';

-- Adresses équipe (boîtes @htbm.fr, cohérentes avec le Rooftop Site-BW) :
update public.hotels set email_equipe = 'contact-lesvoiles@htbm.fr' where nom ilike '%voiles%';
update public.hotels set email_equipe = 'contact-corniche@htbm.fr'  where nom ilike '%corniche%';
