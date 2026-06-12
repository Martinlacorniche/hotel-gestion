-- 12 — planning_config : dédoublonnage + contraintes d'unicité
--
-- Contexte (2026-06-12) : 8 paires (user_id, hotel_id) existaient en double
-- (copies identiques), et rien n'empêchait d'en recréer. Les doublons ont déjà
-- été purgés via l'API ce jour ; la purge ci-dessous est défensive (idempotente).
--
-- L'app suppose UNE ligne par (salarié, hôtel) — resp. (service, hôtel) pour
-- les en-têtes. On le garantit ici. NB : le code fait update→insert (pas
-- d'ON CONFLICT), donc cette migration n'est pas un prérequis au déploiement.

-- Purge des doublons user (on garde une ligne par paire, arbitraire car copies identiques)
delete from public.planning_config a
using public.planning_config b
where a.user_id is not null
  and a.user_id = b.user_id
  and a.hotel_id = b.hotel_id
  and a.ctid > b.ctid;

-- Purge des doublons en-têtes de service (aucun connu, défensif)
delete from public.planning_config a
using public.planning_config b
where a.service_id is not null
  and a.service_id = b.service_id
  and a.hotel_id = b.hotel_id
  and a.ctid > b.ctid;

create unique index if not exists planning_config_user_hotel_uniq
  on public.planning_config (user_id, hotel_id)
  where user_id is not null;

create unique index if not exists planning_config_service_hotel_uniq
  on public.planning_config (service_id, hotel_id)
  where service_id is not null;
