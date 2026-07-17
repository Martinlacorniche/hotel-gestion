-- 93 — Fermer l'escalade de privilèges sur public.users.
--
-- LE PROBLÈME. Une seule policy couvrait la table :
--     authenticated_all : FOR ALL TO authenticated USING (auth.uid() IS NOT NULL)
-- Autrement dit, tout compte connecté pouvait lire, INSÉRER, MODIFIER et
-- SUPPRIMER n'importe quelle ligne. Concrètement, depuis la clé publique de
-- l'app :
--     update public.users set role = 'superadmin' where id_auth = <le sien>;
--     insert into public.users (id_auth, role, ...) values (<le sien>, 'admin', ...);
-- Ce n'est pas théorique : il y a 41 comptes dans auth.users pour 26 lignes ici
-- (d'anciens employés dont la ligne applicative a été retirée). Chacun est
-- `authenticated` et pouvait donc se re-créer une ligne en admin.
--
-- POURQUOI DES GRANTS ET PAS SEULEMENT UNE POLICY. Une policy RLS filtre les
-- LIGNES, jamais les COLONNES : `USING (id_auth = auth.uid())` limite bien
-- chacun à sa propre ligne, mais ne l'empêche pas d'y écrire role='superadmin'.
-- Les privilèges au niveau colonne, eux, sont vérifiés par PostgreSQL avant
-- toute policy — le verrou tient même si une policy est un jour mal écrite.
--
-- CE QUI EST AUTORISÉ AU CLIENT. Audit des deux applications (web + mobile) :
-- toutes les écritures légitimes depuis la clé anon visent SA PROPRE ligne et
-- ne touchent que des préférences ou de la télémétrie d'appareil. La liste
-- ci-dessous est exhaustive à la date du 2026-07-17 :
--     theme, font_family, emoji, default_hotel_id   → /profil (web)
--     nav_order                                     → AppShell (web, drag&drop menu)
--     planning_hidden_services                      → /planning (web)
--     welcome_blocks                                → /reglages-accueil (mobile)
--     mobile_tabs                                   → /reglages-onglets (mobile)
--     expo_push_token                               → enregistrement push (mobile)
--     app_version, app_version_updated_at           → télémétrie (mobile)
--
-- ⚠️ AJOUTER UNE PRÉFÉRENCE ÉCRITE PAR LE CLIENT = l'ajouter au GRANT ci-dessous,
-- sinon l'écriture est refusée. Et plusieurs de ces écritures sont
-- fire-and-forget (app_version, nav_order, planning_hidden_services : aucune
-- gestion d'erreur côté code) — un oubli ne lèvera AUCUNE erreur visible, la
-- donnée se figera en silence. C'est le piège de cette migration.
--
-- CE QUI RESTE INTERDIT AU CLIENT : role, active, hotel_id, email, name,
-- birth_date, employment_*, ordre, id_auth, pinned_tools. Ces colonnes ne sont
-- écrites que par les API routes en service_role (invite / deactivate /
-- reactivate / update-role / update-profile), que la RLS n'affecte pas.
--
-- Le SELECT reste large À DESSEIN : le planning, le dashboard, la maintenance et
-- les anniversaires lisent tous les collègues. Restreindre les colonnes lisibles
-- (expo_push_token, birth_date sont exposés) demande une vue dédiée — chantier
-- distinct, à ne pas mélanger avec celui-ci.

-- ---------------------------------------------------------------------------
-- 1. Privilèges : plus aucune écriture par la clé publique, sauf les colonnes
--    de préférences.
-- ---------------------------------------------------------------------------
-- anon n'a jamais eu de raison d'écrire ici (la policy le bloquait déjà, mais
-- il gardait les GRANTs : la RLS était le seul rempart).
revoke insert, update, delete, truncate on public.users from anon;
revoke insert, update, delete, truncate on public.users from authenticated;

-- INSERT : jamais par le client. La création passe par /api/users/invite
-- (service_role, réservé aux admins).
-- DELETE : jamais, par personne. Conservation légale des plannings — la
-- désactivation se fait par `active = false` via /api/users/deactivate.

grant update (
  theme,
  font_family,
  emoji,
  default_hotel_id,
  nav_order,
  planning_hidden_services,
  welcome_blocks,
  mobile_tabs,
  expo_push_token,
  app_version,
  app_version_updated_at
) on public.users to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Policies : chacun ne touche que sa ligne.
-- ---------------------------------------------------------------------------
drop policy if exists "authenticated_all" on public.users;

-- Lecture : inchangée en pratique (tout compte connecté lit la table).
create policy "users_select_authenticated"
  on public.users for select to authenticated
  using (true);

-- Écriture : sa propre ligne uniquement. Combiné au GRANT ci-dessus, le champ
-- d'action se réduit à « mes préférences, sur moi ».
-- Le WITH CHECK interdit en prime de réattribuer sa ligne à quelqu'un d'autre.
create policy "users_update_self"
  on public.users for update to authenticated
  using (id_auth = auth.uid())
  with check (id_auth = auth.uid());

-- Pas de policy INSERT ni DELETE : sans policy, la RLS refuse — et le REVOKE
-- ci-dessus refuse déjà avant. Deux verrous plutôt qu'un.
