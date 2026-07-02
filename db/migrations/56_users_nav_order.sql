-- Personnalisation du menu par utilisateur : ordre des items de 1er niveau.
-- Chaque user range son menu (drag & drop dans la sidebar). Stocke un tableau
-- d'ids d'outils (ex. ["planning","thune","haccp",...]) ; les ids absents
-- retombent à la fin dans l'ordre par défaut. Même mécanique que
-- planning_hidden_services (écrit côté client sur sa propre ligne).
-- À coller dans le SQL editor Supabase.

alter table public.users
  add column if not exists nav_order jsonb;
