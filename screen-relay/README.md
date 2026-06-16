# Relais écran SmallTV-Ultra

Petit service qui lit les messages écrits depuis la page `/ecran` du site
(stockés dans Supabase, table `screen_messages`) et les affiche sur l'écran
GeekMagic SmallTV-Ultra du réseau local.

```
Page /ecran (cloud) → Supabase → [CE worker, sur le LAN] → écran SmallTV
```

Le worker ne fait que des connexions **sortantes** (Supabase HTTPS + écran en
HTTP local). Aucun port à ouvrir, rien d'exposé sur internet.

## Prérequis

1. **La table existe** : avoir joué `db/migrations/22_screen_messages.sql` puis
   `db/security/16_screen_messages_rls.sql` dans le SQL Editor Supabase.
2. La machine est sur **le même réseau que l'écran** (`ping 192.168.0.57` répond).
3. Python 3.9+.

## Installation (Ubuntu, démarrage automatique au boot)

```bash
# 1) Dépendances système : Python venv + polices texte et emoji
sudo apt update
sudo apt install -y python3-venv fonts-dejavu fonts-noto-color-emoji

# 2) Copier le dossier dans /opt et créer l'environnement Python
sudo mkdir -p /opt/screen-relay
sudo cp worker.py requirements.txt /opt/screen-relay/
sudo chown -R "$USER":"$USER" /opt/screen-relay
cd /opt/screen-relay
python3 -m venv venv
venv/bin/pip install -r requirements.txt

# 3) Configurer (clé service_role)
cp /chemin/vers/.env.example /opt/screen-relay/.env
nano /opt/screen-relay/.env        # colle SUPABASE_SERVICE_ROLE_KEY

# 4) Test direct (sans Supabase) : doit afficher le texte sur l'écran
venv/bin/python worker.py --once "Test du worker 😀"

# 5) Installer le service systemd (démarrage auto au boot)
sudo cp /chemin/vers/screen-relay.service /etc/systemd/system/
#   adapte User= et les chemins dans le fichier si besoin
sudo systemctl daemon-reload
sudo systemctl enable --now screen-relay

# 6) Vérifier
systemctl status screen-relay
journalctl -u screen-relay -f      # logs en direct
```

À partir de là : tu écris un message depuis la page `/ecran` du site, et il
s'affiche sur l'écran en quelques secondes. Le service redémarre seul s'il
plante et au démarrage du PC.

## Réglages (`.env`)

| Variable | Rôle | Défaut |
|---|---|---|
| `SUPABASE_URL` | URL du projet Supabase | (pré-rempli) |
| `SUPABASE_SERVICE_ROLE_KEY` | clé service_role (lecture de la table) | — |
| `SCREEN_IP` | IP de l'écran sur le LAN | `192.168.0.57` |
| `POLL_INTERVAL` | délai entre deux vérifications (s) | `4` |
| `TEXT_FONT` / `EMOJI_FONT` | polices utilisées pour le rendu | DejaVu / Noto |

## Dépannage

- **L'écran change pas** : `ping $SCREEN_IP` ; vérifier que l'IP n'a pas changé
  (réserver une IP fixe sur la box pour l'écran, c'est plus sûr).
- **Rien ne part** : `journalctl -u screen-relay -e` ; vérifier la clé service_role
  et que la table `screen_messages` existe.
- **Texte coupé / trop petit** : c'est volontaire, le rendu réduit la taille pour
  faire tenir les longs messages (240×240). Plus c'est court, plus c'est gros.

## Notes

- On écrase toujours le même fichier `/image/msg.jpg` sur l'écran (la flash est
  limitée à ~3 Mo).
- API écran utilisée (firmware d'origine, pas d'ESPHome) :
  `POST /doUpload?dir=/image/` (champ `file`) puis `GET /set?img=/image/msg.jpg`.
