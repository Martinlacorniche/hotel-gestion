-- RLS sur public.passes : accès uniquement via service_role (API routes serveur).
-- Aucune policy authenticated/anon → deny-by-default pour les clients front,
-- exactement comme le reste du module serrures (jamais lu côté client direct).

alter table public.passes enable row level security;
