-- ============================================================================
-- Réparation auth.users — colonnes token à NULL (erreur 500 GoTrue)
-- ============================================================================
-- Symptôme : l'API admin "list users" et l'écran Supabase Dashboard → Auth →
-- Users renvoient « Database error finding users » (HTTP 500). Le login normal
-- n'est pas affecté.
--
-- Cause : GoTrue lit certaines colonnes token de auth.users en `text` non-null.
-- Si une ligne a un NULL dans l'une d'elles, le scan échoue et fait planter la
-- liste ENTIÈRE (le scan s'arrête à la 1re ligne illisible).
--
-- Diagnostic 2026-06-16 (via API admin get-by-id, une par une) : 2 lignes
-- fautives, toutes deux des comptes DÉSACTIVÉS :
--   - Alexandre.Jamard@protonmail.com  id=d0512cf1-1b17-44f3-a71f-18a51679b4d4
--   - marwahattab@hotmail.FR           id=73bf158b-e09f-4800-beb3-25ade0f3f139
--
-- Le correctif ci-dessous remet '' (la valeur par défaut GoTrue) partout où un
-- token est NULL. Sans perte de données : ces champs sont des tokens transitoires
-- qui valent '' quand ils ne sont pas utilisés. Idempotent.
--
-- À jouer dans le SQL Editor Supabase (accès postgres complet requis).
-- ============================================================================

-- 1) AVANT — voir quelles colonnes sont NULL sur les lignes fautives
select id, email,
  (confirmation_token is null)         as ct_null,
  (recovery_token is null)             as rt_null,
  (email_change is null)               as ec_null,
  (email_change_token_new is null)     as ectn_null,
  (email_change_token_current is null) as ectc_null,
  (phone_change is null)               as pc_null,
  (phone_change_token is null)         as pct_null,
  (reauthentication_token is null)     as rat_null
from auth.users
where confirmation_token is null
   or recovery_token is null
   or email_change is null
   or email_change_token_new is null
   or email_change_token_current is null
   or phone_change is null
   or phone_change_token is null
   or reauthentication_token is null;

-- 2) RÉPARATION — couvre TOUTES les lignes à NULL (pas seulement les 2 connues,
--    au cas où une ligne hors public.users serait aussi touchée)
update auth.users set
  confirmation_token         = coalesce(confirmation_token, ''),
  recovery_token             = coalesce(recovery_token, ''),
  email_change               = coalesce(email_change, ''),
  email_change_token_new     = coalesce(email_change_token_new, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  phone_change               = coalesce(phone_change, ''),
  phone_change_token         = coalesce(phone_change_token, ''),
  reauthentication_token     = coalesce(reauthentication_token, '')
where confirmation_token is null
   or recovery_token is null
   or email_change is null
   or email_change_token_new is null
   or email_change_token_current is null
   or phone_change is null
   or phone_change_token is null
   or reauthentication_token is null;

-- 3) APRÈS — doit renvoyer 0 ligne
select count(*) as lignes_encore_a_null
from auth.users
where confirmation_token is null
   or recovery_token is null
   or email_change is null
   or email_change_token_new is null
   or email_change_token_current is null
   or phone_change is null
   or phone_change_token is null
   or reauthentication_token is null;
