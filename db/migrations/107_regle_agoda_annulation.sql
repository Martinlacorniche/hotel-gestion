-- 107 — Agoda : la confirmation se contrôle, l'annulation est un doublon.
--
-- CONSTATÉ le 27/07 sur le dossier 683273639 (Les Voiles) :
--   12:51  AGODA   CONFIRMATION  → resa_ota / contrôle   (corrigé à la main le matin)
--   13:06  AGODA   CANCELLED     → autre / rien          ← restait en attente
--   13:08  D-EDGE  Annulation    → resa_ota / contrôle
--
-- Deux enseignements de ce dossier :
--   · D-Edge n'a PAS annoncé la réservation initiale, seulement son annulation.
--     « D-Edge fait foi » n'est donc vrai que pour les annulations — archiver
--     tout ce qui vient d'Agoda ferait rater des réservations entières.
--   · L'annulation, elle, arrive bien deux fois. La traiter deux fois ne sert
--     personne.
--
-- POURQUOI UNE RÈGLE ET PAS UNE CORRECTION. La boucle d'apprentissage
-- (`assistant_mail_corrections`) dédoublonne par EXPÉDITEUR et ne garde que la
-- plus récente. Confirmation et annulation partagent `no-reply@agoda.com` :
-- enregistrer l'annulation aurait effacé la correction du matin, et le
-- classifieur se serait mis à archiver les confirmations. Ici les deux cas
-- cohabitent dans un même texte.
--
-- ⚠️ RISQUE ASSUMÉ (Martin, 27/07). Junior ne voit qu'un mail à la fois : il
-- archive l'annulation sans pouvoir vérifier que D-Edge a bien suivi. Si D-Edge
-- en rate une, la chambre reste bloquée pour un client qui ne viendra pas.
-- Arbitrage pris sur un seul dossier observé — à revoir si le cas se présente.

insert into junior_regles (hotel_key, titre, regle, portee, origine)
select 'voiles',
       'Agoda : la confirmation compte, l''annulation fait doublon',
       'Les réservations des Voiles arrivent par DEUX canaux qui se recoupent mal : Agoda en direct, et D-Edge (le channel manager).
· Une CONFIRMATION Agoda (« CONFIRMATION », « Numéro de réservation ») se traite normalement en contrôle de réservation. D-Edge n''annonce pas toujours les nouvelles réservations : si tu l''archives, personne ne verra jamais ce séjour.
· Une ANNULATION Agoda (« CANCELLED », « Annulation ») est un DOUBLON : D-Edge envoie la même annulation dans la foulée et c''est elle qui est traitée. Range-la sans action, ne la mets pas dans la file.
· Ce qui distingue les deux, c''est le mot dans l''objet, pas l''expéditeur : les deux viennent de no-reply@agoda.com.',
       'redaction',
       'Dossier 683273639 du 27/07/2026 : l''annulation est arrivée par Agoda (13h06) puis par D-Edge (13h08), mais la réservation initiale n''était passée que par Agoda (12h51). Martin tranche : on archive l''annulation Agoda, on garde le contrôle sur la confirmation.'
where not exists (
  select 1 from junior_regles
  where titre = 'Agoda : la confirmation compte, l''annulation fait doublon'
);
