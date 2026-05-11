# Agent encodeur TTHotel

Tourne sur le **PC Windows** où l'encodeur de cartes USB (E3/E4 Sciener) est
branché. Poll Supabase pour les jobs `queued`, pilote le DLL Sciener pour
encoder physiquement la carte, marque le job `done` (ou `error`).

## Installation Windows

1. **Python 3.10+** depuis https://www.python.org/downloads/ (cocher *Add to PATH*)
2. Ouvrir PowerShell dans ce dossier :
   ```powershell
   python -m pip install requests
   ```
3. Récupérer le **Card Encoder DLL Demo** sur le portail dev TTLock (à côté du
   manuel `Card Encoder DLL User Manual - Eng.docx`). Le zip contient :
   - `CardEncoder.dll`
   - `mfc140u.dll`, `mfc140ud.dll`, `msvcp140.dll`, `msvcp140d.dll`
   - `ucrtbase.dll`, `ucrtbased.dll`, `vcruntime140.dll`, `vcruntime140d.dll`

   Créer un sous-dossier `lib/` et **y déposer tous ces .dll** :
   ```
   agent_encodeur/
     ├── agent.py
     ├── encoder_dll.py
     ├── .env
     └── lib/
         ├── CardEncoder.dll
         ├── mfc140u.dll
         └── …
   ```

4. Brancher l'encodeur USB. Ouvrir **Gestionnaire de périphériques → Ports
   (COM et LPT)** et noter le port (ex. `COM3`).

5. Copier `.env.example` → `.env` et renseigner :
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `AGENT_HOTEL_ID`
   - `TTHOTEL_CLIENT_ID` / `TTHOTEL_CLIENT_SECRET`
   - **`AGENT_ENCODER_PORT=COM3`** (le port noté à l'étape 4)

6. Lancer :
   ```powershell
   python agent.py
   ```
   Au démarrage l'agent doit afficher *mode RÉEL* et *Encodeur prêt*.
   S'il affiche *mode STUB*, c'est que le port n'est pas renseigné ou
   que le DLL est absent.

## Mode STUB (sans matériel)

Si `AGENT_ENCODER_PORT` est vide OU que `lib/CardEncoder.dll` est absent,
l'agent simule l'encodage (2 s d'attente puis `done`). Utile pour tester
le flow Supabase → UI sans toucher au matériel.

## Démarrage automatique au boot

Créer un raccourci dans `shell:startup` (taper dans Win+R) pointant vers :
```
pythonw.exe C:\chemin\complet\agent_encodeur\agent.py
```
`pythonw` n'affiche pas de console. Les logs Python vont alors dans le néant ;
pour debug, lancer avec `python` (avec console) ou rediriger la sortie dans un
fichier.

## Erreurs DLL fréquentes

| Code | Sens | Que faire |
|------|------|-----------|
| 13 | hotelInfo expiré (>10 min) | l'agent rafraîchit et retry, normalement transparent |
| 14 | Carte d'un autre hôtel | utiliser une carte initialisée pour cet hôtel |
| 16 | Encodeur déconnecté | vérifier le câble USB et le port COM |
| 101 / 106 | Carte mal positionnée ou non initialisée | repositionner ou appeler `CE_InitCard` d'abord |

## Architecture

```
Backend Next.js (POST /sejours)
  └─ insère 1 job par carte dans `jobs_encodeur` avec payload :
        { locks: [{lockId, mac, buildNo, floorNo}, ...], fin, ... }

[agent.py] tourne en boucle
  ├─ poll Supabase pour jobs `queued`
  ├─ claim atomique (PATCH where statut=queued)
  ├─ pour chaque lock du payload :
  │    CE_WriteCard(hotelInfo, buildNo, floorNo, mac, expireTs, false)
  ├─ marque job done + active les séjours (pending → actif)
  └─ recommence
```
