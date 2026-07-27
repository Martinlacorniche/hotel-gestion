-- Le garde-fou anti-invention de prix sort du code et devient une règle partagée.
--
-- Il vivait en dur dans le prompt de `mailActions.ts` (« tu ne rédiges pas une
-- réponse en inventant un chiffre »), donc côté web uniquement. Junior tourne sur
-- le serveur de La Corniche et ne lit pas ce code : tant qu'il se contentait
-- d'enquêter ça ne coûtait rien, mais depuis qu'il rédige (2026-07-27) il pouvait
-- écrire un tarif inventé dans une réponse client.
--
-- En base et en portée `les_deux`, la règle est lue des deux côtés — et Martin
-- peut la corriger depuis /junior sans redéploiement ni passage par moi.

insert into junior_regles (hotel_key, titre, regle, portee, origine)
select null,
       'On n''invente jamais un chiffre',
       'Un prix, une remise, une disponibilité, une date limite : si ce n''est pas ' ||
       'écrit dans le dossier, le mail ou la fiche, tu ne l''écris pas. Tu poses la ' ||
       'question et tu attends la réponse — un chiffre inventé part chez le client ' ||
       'et nous engage. Mieux vaut demander que se tromper.',
       'les_deux',
       'convergence rédaction 2026-07-27'
where not exists (
  select 1 from junior_regles where titre = 'On n''invente jamais un chiffre'
);
