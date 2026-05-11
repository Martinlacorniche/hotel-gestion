# Procédure d'installation sur le PC Windows

Pas-à-pas pour faire tourner l'agent encodeur sur le PC qui a l'encodeur USB.

## 1. Préparer Python

1. Aller sur https://www.python.org/downloads/windows/
2. Télécharger **Python 3.10 ou plus récent**, version **64-bit** (Windows installer (64-bit))
3. Lancer l'installeur. **Cocher "Add python.exe to PATH"** avant de cliquer Install
4. Une fois installé, ouvrir **PowerShell** et taper :
   ```powershell
   python --version
   ```
   Doit afficher `Python 3.10.x` ou plus.

## 2. Copier l'agent

1. Dézipper `agent_encodeur.zip` à un endroit pratique, par exemple :
   ```
   C:\Users\<TonNom>\agent_encodeur\
   ```
2. Le dossier doit contenir :
   ```
   agent.py
   encoder_dll.py
   .env
   PROCEDURE_WINDOWS.md
   README.md
   lib\
     CardEncoder.dll
     mfc140u.dll
     msvcp140.dll
     ucrtbase.dll
     vcruntime140.dll
     (+ versions "d.dll")
   ```

## 3. Installer la librairie `requests`

Dans PowerShell, depuis le dossier :
```powershell
cd C:\Users\<TonNom>\agent_encodeur
python -m pip install requests
```

## 4. Brancher l'encodeur et trouver le port COM

1. Brancher l'encodeur USB sur le PC
2. **Win + X** → **Gestionnaire de périphériques**
3. Dérouler **Ports (COM et LPT)**
4. Tu dois voir une entrée style "USB Serial Port (COM3)" ou similaire
5. Noter le numéro (ex. `COM3`)

Si tu ne vois rien : il faut peut-être installer le pilote (souvent CH340 ou FTDI),
fourni avec l'encodeur ou téléchargeable chez le fabricant.

## 5. Configurer l'.env

Ouvrir le fichier `.env` (avec Bloc-notes ou autre). Trouver la ligne :
```
AGENT_ENCODER_PORT=
```
et la remplacer par :
```
AGENT_ENCODER_PORT=COM3
```
(remplace `COM3` par ton port noté à l'étape 4)

Tout le reste est déjà rempli (clés Supabase et TTHotel).

## 6. Lancer l'agent

Dans PowerShell, depuis le dossier de l'agent :
```powershell
python agent.py
```

Au démarrage tu dois voir :
```
HH:MM:SS INFO    Agent démarré · hôtel ded6e6fb-... · mode RÉEL · poll 2.0s
HH:MM:SS INFO    Initialisation encodeur sur COM3…
HH:MM:SS INFO    hotelInfo rafraîchi
HH:MM:SS INFO    Encodeur prêt
```

Si tu vois **mode STUB** → relire l'étape 5 (port pas renseigné) ou vérifier
que `lib\CardEncoder.dll` est bien là.

Pour arrêter : **Ctrl + C** dans PowerShell.

## 7. Premier test

Garder PowerShell ouvert avec l'agent qui tourne.

Côté web (`http://localhost:3000/serrures`) : crée un séjour carte.
**Pose une carte hôtel sur l'encodeur dès que tu vois "Posez la carte…"**.

Tu dois voir dans PowerShell :
```
HH:MM:SS INFO    Job xxx claimé · encodage…
HH:MM:SS INFO    Carte 1/1 → 1 serrure(s), expire 2026-XX-XXTYY:00:00+00:00
HH:MM:SS INFO      ✓ écrit pour F02341601691A (build=1, floor=3)
HH:MM:SS INFO    Job xxx done
```

Tester la carte sur la serrure de la chambre 11 → elle doit ouvrir.

## Première carte vierge

Si la carte est **vierge** (jamais initialisée pour un hôtel), `CE_WriteCard`
va renvoyer **code 106** ("Carte d'un autre hôtel ou non initialisée"). Dans ce
cas il faut d'abord l'initialiser. Pour le PoC tu peux :
- Soit utiliser une carte déjà initialisée par TTHotel desktop (= carte hôtel)
- Soit me demander d'ajouter une étape `CE_InitCard` automatique dans l'agent

## Erreurs fréquentes

| Code | Sens | Solution |
|------|------|----------|
| 13 | hotelInfo expiré | l'agent refresh tout seul, normalement transparent |
| 14 | Carte d'un autre hôtel | utiliser une carte de **cet** hôtel |
| 16 | Encodeur déconnecté | vérifier câble USB et le port COM |
| 101 / 106 | Carte mal posée / non initialisée | reposer ou initialiser |

## Démarrage automatique (plus tard, en prod)

1. **Win + R** → taper `shell:startup`
2. Créer un raccourci pointant vers :
   ```
   pythonw.exe C:\Users\<TonNom>\agent_encodeur\agent.py
   ```
3. `pythonw` (sans le `w` → pas de console). L'agent démarrera au login Windows.
