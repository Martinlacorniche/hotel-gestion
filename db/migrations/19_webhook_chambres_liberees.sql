-- ============================================================================
-- 19 — Webhook notif "chambres libérées" (câblé mais INERTE)
-- ============================================================================
-- Chaque INSERT dans chambres_liberees appelle l'edge function
-- send-chambres-liberees (ciblage housekeeping en service, côté serveur).
-- SANS RISQUE à poser dès maintenant : la fonction refuse d'envoyer tant que
-- le secret LIBERATIONS_PUSH_ENABLED n'est pas à "1" (interrupteur maître,
-- vérifié). L'activation jour J ne touche plus à la base.
--
-- Même mécanisme que les Database Webhooks du dashboard (pg_net, asynchrone —
-- n'ajoute aucune latence à l'insertion). Idempotent.

DROP TRIGGER IF EXISTS send_chambres_liberees_webhook ON public.chambres_liberees;
CREATE TRIGGER send_chambres_liberees_webhook
  AFTER INSERT ON public.chambres_liberees
  FOR EACH ROW
  EXECUTE FUNCTION supabase_functions.http_request(
    'https://drdlcohzfjdogyquglcs.supabase.co/functions/v1/send-chambres-liberees',
    'POST',
    '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRyZGxjb2h6Zmpkb2d5cXVnbGNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk1NDk1NDYsImV4cCI6MjA2NTEyNTU0Nn0.uPRYdTX9F0ccSdCTcUta7UyzahcPCZeFmoxIpuKamME"}',
    '{}',
    '5000'
  );
