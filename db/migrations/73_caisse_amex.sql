-- Sépare les encaissements carte en TPE CB et TPE AMEX (Les Voiles) dans la caisse.
-- Nouveau moyen de paiement « TPE AMEX » : ses montants PMS/réel vivent dans leurs
-- propres colonnes, à côté du TPE (CB) existant (pms_tpe/reel_tpe). Défaut 0 pour ne
-- rien changer aux caisses historiques.
alter table public.caisse_shifts
  add column if not exists pms_amex  numeric not null default 0,
  add column if not exists reel_amex numeric not null default 0;
