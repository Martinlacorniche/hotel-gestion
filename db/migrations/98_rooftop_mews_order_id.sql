-- 98 — Trace de la charge Rooftop poussée dans Mews.
--
-- Depuis le 2026-07-23 le POS pousse les CONSOMMATIONS dans Mews (orders/add),
-- en plus du règlement qui partait déjà (payments/addExternal). Cette colonne
-- porte l'identifiant de la commande Mews créée pour l'addition.
--
-- Elle sert d'ANTI-DOUBLON, et ce n'est pas un confort : `orderItems/cancel` est
-- fermé sur notre scope (401), donc une charge postée deux fois ne peut pas être
-- annulée par l'API — il faudrait la supprimer à la main dans le PMS.
-- Renseignée = l'addition est déjà dans Mews, on ne repousse jamais.

alter table public.rooftop_orders
  add column if not exists mews_order_id text;

comment on column public.rooftop_orders.mews_order_id is
  'Id de la commande Mews (orders/add) portant les charges de cette addition. NULL = pas encore poussée. Sert d''anti-doublon : orderItems/cancel est fermé, un doublon ne s''annule pas par l''API.';
