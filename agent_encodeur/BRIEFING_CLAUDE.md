# Briefing pour Claude (session Windows)

Tu es Claude Code, invoqué sur la machine Windows de Martin pour reprendre le travail sur l'**agent encodeur de cartes TTHotel**. Ce document te donne tout le contexte projet — la machine Linux d'origine garde la mémoire, toi tu pars de zéro ici.

## Le projet en 30 secondes

`siteconsignes` (Next.js + Supabase, déployé sur `consigneshtbm.com`) remplace le client TTHotel desktop des réceptionnistes par une UI ultra-simplifiée. **Hôtel pilote : Les Voiles HTBM.**

Le **backend Next.js tourne ailleurs** (machine Linux de Martin / prod Vercel). Ici sur ce Windows ne tourne que **l'agent Python** de ce dossier : il poll Supabase pour les jobs d'encodage et tape la **DLL Sciener CardEncoder** pour écrire physiquement sur les cartes RFID.

## État au 2026-05-11

### ✅ Ce qui marche
- Backend Next.js complet (API routes `/api/serrures/*`)
- Schéma Supabase : `hotels`, `chambres`, `sejours`, `jobs_encodeur` (payload jsonb). RLS + policies `authenticated`.
- UI 3 colonnes `/serrures` + page config `/serrures/config`
- **Code PIN 4 chiffres** : fonctionne en vrai sans gateway via `/v3/keyboardPwd/add` (sans `addType`, code custom généré côté Node, évite patterns triviaux). La serrure valide en local par algo.
- Multi-chambres + multi-cartes dans le flow
- Heure de checkout libre (input time HH:MM)
- Agent Python en place (`agent.py`, `encoder_dll.py`) avec poll Supabase + queue + activation séjours

### ⏸️ Ce qui bloque : l'encodage carte
- L'**encodeur E5 testé ne marche pas** avec le SDK public Sciener. Erreurs **codes 27 / 38** (non documentés dans le manuel). La DLL fournie par TTHotel desktop est `1.7.0.68`, jamais publiée publiquement.
- Décision : Martin a commandé un **encodeur E4** (supporté nativement par le SDK 1.6.6.66, et même la 1.6.1.2 d'origine — toutes deux publiques)
- **À la réception du E4 : brancher, noter le port COM, mettre `AGENT_ENCODER_PORT=COMx` dans `.env`, lancer `python agent.py` — ça doit marcher direct sans modif de code.**
- Si erreur : `python test_encoder.py` pour isoler le problème DLL hors flow Supabase.

## Architecture détaillée

### Flow d'un encodage
```
[UI /serrures]  →  POST /api/sejours
                        ↓
                  Insert dans jobs_encodeur (statut=queued)
                  payload = { lockIds, locks:[{lockId,mac,buildNo,floorNo}],
                              sejourIds, debut, fin, carte_index, total_cartes }
                        ↓
                  [agent.py] (cette machine Windows)
                        ↓
                  Poll Supabase (toutes les 2 s)
                  → claim atomique (PATCH where statut=queued)
                  → pour chaque lock du payload :
                      CE_WriteCard(hotelInfo, buildNo, floorNo, mac, expireTs, false)
                  → marque job done + active séjours (pending → actif)
```

### Méthodes d'ouverture des serrures
Deux méthodes décidées avec Martin :
- **Code PIN 4 chiffres** ✅ marche
- **Carte RFID** ⏸️ attend l'E4

Méthodes rejetées :
- **eKey (app TTLock)** → trop de friction pour les réceptionnistes
- **Empreinte** → plus tard

### Endpoints TTHotel utilisés
Base : `https://euapi.ttlock.com`
- `/oauth2/token` — auth
- `/v3/lock/list`, `/v3/lock/listByHotel` — liste serrures
- `/v3/hotel/getInfo` — **hotelInfo valable 10 min**, l'agent doit le refresh sur erreur 13
- `/v3/keyboardPwd/add` — sans `addType` pour ne pas exiger de gateway
- `/v3/keyboardPwd/delete` — exige gateway donc on log + ignore l'échec (code expire de lui-même à `endDate`)

### Chambre de test
Chambre 11 du Voiles (déjà câblée pour les PoC) :
- `tthotel_lock_id=31259014`
- `mac=F0:23:41:60:16:9A`
- `buildingNumber=1`, `floorNumber=3`
- Pas de gateway
- `noKeyPwd` existant = `1082` (code permanent système, ne pas toucher)

### Ressources externes
- **Repo Gitee Sciener officiel** : `gitee.com/sciener/CardEncoderPlus` (versions DLL publiées, max **1.6.6.66**)
- Manuel : `Card Encoder DLL User Manual - Eng.docx` (sur le portail dev TTLock, à côté du zip CardEncoderDemo)
- La DLL `1.7.0.68` utilisée par TTHotel desktop n'est **pas** sur Gitee — elle est embarquée dans le binaire desktop, jamais distribuée standalone.

## Codes d'erreur DLL fréquents

| Code | Sens | Action |
|------|------|--------|
| 13 | hotelInfo expiré (>10 min) | l'agent refresh tout seul, transparent |
| 14 | Carte d'un autre hôtel | utiliser une carte initialisée pour cet hôtel |
| 16 | Encodeur déconnecté | vérifier câble USB + port COM |
| 27, 38 | Apparus avec l'E5 | **non documentés** — c'est pour ça qu'on passe au E4 |
| 101, 106 | Carte mal posée / non initialisée | reposer ou appeler `CE_InitCard` d'abord |

## Si la première carte est vierge
`CE_WriteCard` renvoie **code 106**. Soit utiliser une carte déjà initialisée par TTHotel desktop, soit on ajoute une étape `CE_InitCard` automatique dans l'agent (pas encore fait — à discuter avec Martin si le cas se présente).

## Comment Martin bosse

- Français, ton direct, coupe court face aux options multiples → si tu lui proposes des choix, **mets ta reco en premier et sois bref**
- Décision close = exécuter et passer. Ne pas relancer d'options après "non/laisse/c'est chiant".
- Préférence : 1-2 phrases de récap en fin de tour, pas plus.
- Quand tu modifies du code, ne pas ajouter de commentaires explicatifs sur ce que le code fait — Martin lit le diff.

## Secrets (.env)
- Le `.env` est déjà rempli avec les vrais secrets (clé service_role Supabase + secret TTHotel)
- **NE JAMAIS** committer ce `.env` ni le coller en mémoire
- Si tu dois en reparler, masque les valeurs

## Premier réflexe quand tu arrives ici

1. Lire ce briefing (tu es en train)
2. Lire `PROCEDURE_WINDOWS.md` (installation pas-à-pas)
3. Demander à Martin : "L'E4 est branché ? Quel port COM ?"
4. Si oui : `python test_encoder.py` puis `python agent.py`
5. Si erreur : lire le code retour dans le tableau ci-dessus, et regarder `encoder_dll.py` pour la séquence d'init
