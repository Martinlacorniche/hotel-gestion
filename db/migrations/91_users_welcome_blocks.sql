-- 91 — Préférences d'affichage du briefing de démarrage (app mobile).
--
-- Le popup d'ouverture de l'app a deux modes :
--   1. Le FLASH INFO de la Direction — non concerné ici. C'est un message
--      descendant qui doit être lu (bouton « J'ai bien lu », traçé dans
--      flash_infos.read_by) : il n'est pas désactivable, sinon il ne sert plus
--      à rien.
--   2. Le BRIEFING du jour (1×/jour) — c'est lui que cette colonne pilote.
--
-- FORME DE LA VALEUR : un objet { "<clé de bloc>": true|false }.
-- On ne stocke QUE les écarts au défaut. Un bloc absent de l'objet prend le
-- `defaultOn` déclaré dans lib/welcomeBlocks.js côté app. C'est ce qui rend le
-- registre extensible : ajouter un bloc au code le rend visible chez tout le
-- monde sans avoir à réécrire une seule ligne de cette colonne.
-- Ne PAS transformer ça en liste de clés actives — il faudrait alors migrer les
-- données de tous les users à chaque nouveau bloc.
--
-- Exemple : {"meteo": false} = « je vois tout le briefing sauf la météo ».

alter table public.users
  add column if not exists welcome_blocks jsonb not null default '{}'::jsonb;

comment on column public.users.welcome_blocks is
  'Préférences perso du briefing de démarrage mobile. Objet {cle_bloc: bool} ne contenant que les écarts au défaut du registre (lib/welcomeBlocks.js). Absent = valeur par défaut du bloc.';

-- Garde-fou : on veut un objet, pas un tableau ni un scalaire. Sans ça, un
-- `["meteo"]` écrit par erreur passerait et la lecture prefs[key] renverrait
-- undefined en silence — le bloc réapparaîtrait sans qu'on comprenne pourquoi.
alter table public.users
  drop constraint if exists users_welcome_blocks_is_object;
alter table public.users
  add constraint users_welcome_blocks_is_object
  check (jsonb_typeof(welcome_blocks) = 'object');
