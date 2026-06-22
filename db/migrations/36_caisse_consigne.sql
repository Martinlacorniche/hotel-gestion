-- Ligne « € consigne » (encaissements Stripe / site consignes) dans la caisse.
-- pms_consigne : saisi par l'équipe (côté PMS). reel_consigne : figé à la validation
-- du shift (sinon affiché en direct = net Stripe du jour, comme le fond compté).
alter table public.caisse_shifts
  add column if not exists pms_consigne  numeric not null default 0,
  add column if not exists reel_consigne numeric;
