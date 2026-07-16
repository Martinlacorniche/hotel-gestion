-- ============================================================================
-- 88 — Hôtels : le classement (étoiles)
-- ----------------------------------------------------------------------------
-- POURQUOI (Martin 2026-07-16) : « Hôtel la Corniche **** ça serait mieux ». Le mail
-- de confirmation annonce « La Corniche » — le nom INTERNE, celui du switch d'hôtel
-- et du back-office. Ce n'est pas le nom sous lequel on se présente à un client.
--
-- Le classement existait déjà… CODÉ EN DUR dans la vitrine, deviné par le nom :
--     function hotelStars(name) {
--       if (name.toLowerCase().includes("corniche")) return 4;
--       if (name.toLowerCase().includes("voiles"))   return 3;
--     }
-- C'est le TROISIÈME cas de la même journée après les adresses (migration 87) et le
-- montant de la taxe de séjour (migration 84) : une donnée d'hôtel qui vit dans le
-- code au lieu de la base. On la remonte à la source, et tout ce qui s'adresse au
-- client peut la lire.
--
-- On stocke le CLASSEMENT, pas un libellé tout fait : le nom d'affichage se compose
-- (« Hôtel » + nom + étoiles), et un classement se met à jour tout seul partout.
-- ============================================================================

alter table public.hotels
  add column if not exists etoiles smallint;

alter table public.hotels drop constraint if exists hotels_etoiles_check;
alter table public.hotels
  add constraint hotels_etoiles_check check (etoiles is null or etoiles between 1 and 5);

comment on column public.hotels.etoiles is
  'Classement de l''hôtel (1-5). Sert à composer le nom affiché aux clients (« Hôtel Les Voiles ★★★ »). Remplace le hotelStars() codé en dur dans la vitrine, qui devinait le classement à partir du nom.';

update public.hotels set etoiles = 4 where nom = 'La Corniche' and etoiles is null;
update public.hotels set etoiles = 3 where nom = 'Les Voiles'  and etoiles is null;
