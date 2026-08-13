# Repères pour l'assistant

Ce fichier est chargé à chaque ouverture de session dans ce dossier. Il ne
documente pas le projet : il liste les commandes qu'on oublie entre deux
sessions, et les gardes-fous à ne pas franchir sans le dire.

## Certification HotSoft (Planet)

Le runner rejoue les 38 scénarios en **lecture** du classeur de certification,
indexés par onglet et numéro de test. Pensé pour répondre en direct pendant la
visio avec Planet.

```bash
npm run certif                 # les 38 (~3 min)
npm run certif -- GetRooms#3   # un seul test (~4 s)
npm run certif -- GetReservations   # un onglet entier
npm run certif:list            # le catalogue des tests
npm run hotsoft:sweep          # balayage de couverture → docs/hotsoft-couverture.md
```

**Trois verdicts, pas deux.** ✅ vérifié automatiquement · 👀 **à confronter à
l'écran HotSoft** (le classeur demande que le nombre de lignes corresponde au
leur — ce n'est **pas** un échec, le runner sort le chiffre à annoncer) ·
❌ échec réel. Dernière passe complète : 21 ✅ / 17 👀 / 0 ❌.

Tout passe par `run.sh`, qui transpile `src/lib/hotsoft.ts` dans `.build/` (le
Node de cette machine ne lit pas le TypeScript) et charge `.env.hotsoft-demo`.
Il **refuse de tourner** si la base ne pointe pas le bac à sable.

Les pièges d'appel de l'API (statuts en tableaux, `Folios/Get` au lieu de
`GetReservationFolios`, `RoomType` qui est un objet…) sont documentés en tête de
`scripts/hotsoft-certif/certif.mjs`.

## SQL Supabase

J'exécute le SQL moi-même, pas de copier-coller de migration dans le dashboard :

```bash
node scripts/sql.mjs "select 1"                  # requête inline
node scripts/sql.mjs -f db/migrations/57_x.sql   # un fichier
node scripts/sql.mjs -f x.sql --dry              # afficher sans exécuter
```

⚠️ Rôle `postgres`, accès total, **rien n'est transactionnel** : encadrer
soi-même par `begin`/`commit` si le script doit être atomique.

## Gardes-fous

- **Boîtes mail** : `src/lib/graphMailbox.ts` n'ouvre que `contact-lesvoiles@` et
  `contact-corniche@`. Le jeton Graph est app-only et ouvre en réalité **toutes**
  les boîtes du tenant. Toute autre boîte (direction@, administration@…) se
  consulte à la demande explicite de Martin, jamais en passant.
- **Jamais supprimer un utilisateur** (conservation légale des plannings) —
  désactivation uniquement.
- **Secrets hors git** : `.env.local`, `.env.mails`, `.env.hotsoft-demo`, et le
  dossier `hotsoft/` (mot de passe + ProviderKey en clair).
- **La Corniche se pilote dans Hotsoft**, que je ne vois pas : sur un dossier
  Corniche, poser la question plutôt que conclure que personne n'a rien fait.
