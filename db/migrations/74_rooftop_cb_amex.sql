-- POS Rooftop : sépare le tender carte en CB et Amex (au lieu du seul 'tpe').
-- On garde 'tpe' dans les valeurs autorisées pour ne pas invalider l'historique
-- (anciennes lignes = CB). Les nouveaux règlements écrivent 'cb' ou 'amex'.
alter table public.rooftop_order_payments drop constraint if exists rooftop_order_payments_method_check;
alter table public.rooftop_order_payments
  add constraint rooftop_order_payments_method_check
  check (method in ('tpe', 'cb', 'amex', 'espece', 'chambre'));

alter table public.rooftop_orders drop constraint if exists rooftop_orders_payment_method_check;
alter table public.rooftop_orders
  add constraint rooftop_orders_payment_method_check
  check (payment_method in ('tpe', 'cb', 'amex', 'espece', 'chambre', 'multi'));
