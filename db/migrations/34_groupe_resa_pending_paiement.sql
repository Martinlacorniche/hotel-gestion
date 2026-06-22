-- Paiement invité obligatoire : une réservation « en attente de paiement » doit
-- tenir la chambre (sinon deux invités pourraient payer la même). On étend l'index
-- unique anti-doublon pour bloquer aussi le statut 'en_attente_paiement'.
-- 'expiree' (non payée à temps) ne bloque pas → la chambre se relibère.

drop index if exists uq_resa_chambre_active;
create unique index uq_resa_chambre_active
  on public.groupe_reservations (groupe_chambre_id)
  where statut in ('confirmee', 'en_attente_paiement');
