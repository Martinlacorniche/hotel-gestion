-- 106 — Les enquêtes de Junior passent par la base, plus par le fil HTTP.
--
-- POURQUOI (Martin 2026-07-27). Le relais `/api/junior/agent` attendait la
-- réponse de Junior dans la fonction Netlify. Or Netlify coupe une fonction
-- synchrone à 26 s ; le code promettait d'attendre 280 s et déclarait
-- `maxDuration = 60` — deux chiffres que la plateforme ne peut pas tenir.
--
-- Conséquence observée : une question posée à 14h35 a été reçue par le serveur,
-- traitée en 36 s avec 4 outils… et jetée. L'écran affichait « réessaie ».
-- Les enquêtes COURTES passaient, les vraies enquêtes étaient perdues — on
-- payait le travail sans jamais le lire.
--
-- Le raisonnement d'origine (« la fonction ne fait qu'attendre, elle tiendra »)
-- est faux : Netlify compte le temps écoulé, pas le temps de calcul. Attendre
-- coûte aussi cher que travailler.
--
-- Désormais le serveur accuse réception en une seconde, enquête à son rythme, et
-- dépose sa réponse ici. L'écran la relève quand elle arrive. Plus aucune limite
-- de durée, et une enquête interrompue laisse une trace au lieu de disparaître.
--
-- ⚠️ C'est la SEULE table où Junior écrit, et il n'y écrit que ses propres
-- réponses. La barrière tient toujours : rien de ce qui touche à l'hôtel — mails,
-- fiches, planning — n'est modifiable par lui. Ce carnet est à lui.

create table if not exists public.junior_enquetes (
  id            uuid primary key default gen_random_uuid(),
  hotel_key     text not null check (hotel_key in ('voiles', 'corniche')),
  question      text not null,
  -- Le dossier ouvert à l'écran au moment de la question, tel qu'il a été envoyé.
  -- Gardé pour pouvoir relire une enquête sans deviner ce que Junior avait sous
  -- les yeux : c'est ce qui manquait pour comprendre le bug du 27/07.
  contexte      text,
  statut        text not null default 'en_cours'
                check (statut in ('en_cours', 'finie', 'echec')),
  reponse       text,
  -- Les outils qu'il a ouverts, dans l'ordre — c'est ce que l'écran affiche sous
  -- la réponse pour qu'on voie où il est allé chercher.
  traces        jsonb not null default '[]'::jsonb,
  erreur        text,
  -- Qui a posé la question (users.id_auth) : une enquête appartient à quelqu'un.
  demandee_par  uuid,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);

-- L'écran interroge sa propre enquête en boucle jusqu'à ce qu'elle aboutisse :
-- c'est la lecture la plus fréquente, elle se fait par id (déjà la clé primaire).
-- Cet index-ci sert au ménage et à la relecture d'une journée.
create index if not exists junior_enquetes_recentes_idx
  on public.junior_enquetes (created_at desc);

comment on table public.junior_enquetes is
  'Les enquêtes de Junior : posées par l''écran, traitées par le serveur de La Corniche, relevées par l''écran. Seule table où l''agent écrit — et seulement ses propres réponses.';

alter table public.junior_enquetes enable row level security;
-- Aucune policy : ni anon ni authenticated n'y touchent. L'écran passe par
-- /api/junior/agent (qui vérifie le rôle), l'agent par la service_role. Une
-- enquête peut contenir un fil client entier — elle n'a rien à faire côté
-- navigateur autrement que filtrée par l'API.
