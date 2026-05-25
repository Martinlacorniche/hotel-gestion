# Déploiement HACCP — Mini-PC La Corniche

**Pour Claude qui reçoit ce dossier** : un POC complet a été validé sur le PC de
Martin avec les 5 sondes Zigbee Tuya ZT01. Ce dossier contient la stack Docker
prête à lancer + l'état du réseau Zigbee (= les 5 sondes restent appairées sans
rien refaire). Ton job : lancer Docker ici et vérifier que ça remonte des
relevés sur Supabase.

## Contexte

Stack à 3 containers Docker :

- **mosquitto** : broker MQTT local (port 1883, LAN only)
- **zigbee2mqtt** : pont Zigbee ↔ MQTT via dongle Sonoff ZBDongle-E (port 8080 = frontend admin)
- **mqtt-bridge** : subscriber Node.js qui insère les relevés dans Supabase

Hôtel cible : **La Corniche** (UUID `f9d59e56-9a2f-433e-bcf4-f9753f105f32`).

Les 5 sondes sont :

| friendly_name | location | type | seuils |
|---|---|---|---|
| frigo_gauche | Frigo Gauche | positif | -1°C / +4°C |
| frigo_droit | Frigo Droit | positif | -1°C / +4°C |
| congel_rs | Congélateur Room Service | négatif | / -15°C |
| congel_pain | Congélateur Pain | négatif | / -15°C |
| congel_viennoiserie | Congélateur Viennoiserie | négatif | / -15°C |

## Ce qui est fourni

- `.env` : déjà rempli (HOTEL_ID Corniche, SUPABASE_URL, SUPABASE_SERVICE_KEY, ZIGBEE_DONGLE_PATH)
- `docker-compose.yml` : Node 22 (patch important — Node 20 manque WebSocket natif)
- `bridge/index.js` : version patchée avec
  - lecture `temperature_probe` (sonde inox déportée HACCP) plutôt que `temperature` (boîtier ambiant)
  - déduplication 0.3°C / 3% HR / keepalive 10 min (évite saturation Supabase)
- `zigbee2mqtt/data/` : état du réseau Zigbee — les 5 sondes y sont déjà mémorisées avec leur IEEE address. **NE PAS SUPPRIMER**, sinon il faudrait re-appairer manuellement avec Martin sur place.
- `mosquitto/config/mosquitto.conf` : config broker MQTT
- `bridge/package.json` : dépendances Node (@supabase/supabase-js, mqtt)

## Procédure d'installation

### Pré-requis sur le mini-PC

- Linux Debian/Ubuntu
- Connexion Internet (HTTPS vers `drdlcohzfjdogyquglcs.supabase.co`)
- Dongle **Sonoff ZBDongle-E** branché sur un port USB
- Le serial du dongle utilisé au POC : `76b6f755f2a0f011b7e63081bb936ffa` (cf. `.env`). C'est le même dongle physique — il sera déplacé du PC de Martin vers ce mini-PC. Le path stable `by-id` est unique au dongle, donc il marche partout où on le branche.

### Étapes

```bash
# 1) Vérifier que Docker est installé (sinon : ./install.sh)
docker --version
docker compose version

# 2) Vérifier que le dongle est bien détecté
ls /dev/serial/by-id/usb-Itead_Sonoff*

# 3) Si le path détecté diffère de celui du .env (autre dongle), mets à jour
#    ZIGBEE_DONGLE_PATH=... dans le .env

# 4) Lancer la stack
sudo docker compose up -d

# 5) Vérifier les containers
sudo docker compose ps
# → 3 containers en "Up"

# 6) Vérifier que Z2M démarre correctement (~30s après up)
sudo docker compose logs --tail=50 zigbee2mqtt
# Chercher : "Coordinator firmware version" + "Connected to MQTT server" + "Zigbee2MQTT started!"

# 7) Vérifier que le bridge charge les 5 sondes
sudo docker compose logs --tail=20 mqtt-bridge
# Chercher : "Loaded 5 active sensors" + "Subscribed to zigbee2mqtt/+"

# 8) Vérifier que les relevés arrivent
sudo docker compose exec mosquitto mosquitto_sub -t 'zigbee2mqtt/#' -v
# Tu devrais voir, dans les ~5 min, des messages comme :
#   zigbee2mqtt/frigo_gauche {"battery_state":"high","humidity":...,"temperature":...,"temperature_probe":...}
# (les Tuya ZT01 émettent toutes les ~30 min, ou immédiatement à chaque variation >0.5°C)
```

### Si Docker n'est pas installé

Lance le script :
```bash
chmod +x install.sh
./install.sh
```

Le script :
- Installe Docker + Docker Compose
- Ajoute l'utilisateur courant au groupe `docker`
- Auto-détecte le dongle et met à jour `.env`
- Lance la stack

⚠️ Si tu viens d'être ajouté au groupe `docker`, soit tu logout/login, soit tu préfixes par `sudo` les commandes Docker.

## Vérification finale (côté Supabase)

Une fois la stack tournante depuis ~5 min, lance cette requête SQL dans le dashboard Supabase pour confirmer que les 5 sondes remontent bien des relevés en BDD :

```sql
SELECT
  s.friendly_name,
  s.location,
  COUNT(r.id) FILTER (WHERE r.recorded_at > NOW() - INTERVAL '10 minutes') AS nb_recents,
  MAX(r.recorded_at) AS dernier_releve,
  MAX(r.temperature) AS derniere_temp
FROM haccp_sensors s
LEFT JOIN haccp_readings r ON r.sensor_id = s.id
WHERE s.hotel_id = 'f9d59e56-9a2f-433e-bcf4-f9753f105f32'
GROUP BY s.id, s.friendly_name, s.location
ORDER BY s.friendly_name;
```

Toutes les sondes doivent avoir au moins 1 relevé récent (`nb_recents >= 1`). Si une sonde n'a pas remonté → vérifier qu'elle est sous tension (pile L92), à portée Zigbee, et que son IEEE address dans `haccp_sensors` correspond bien à celle dans Z2M (frontend `http://<ip-mini-pc>:8080`).

## Pour Martin : installation physique des sondes

Une fois la stack tournante et les relevés confirmés en BDD :

1. **Reposer chaque sonde dans son frigo cible** (cf. tableau ci-dessus)
2. **Passer le câble de la sonde inox** par le joint de porte (pas de perçage)
3. **Le boîtier reste hors-frigo** (radio + pile à T° ambiante)
4. **Attendre 5-10 min** par sonde, vérifier sur le dashboard web (`/haccp`) que la T° affichée est cohérente

Surveiller pendant 24-48h pour valider :
- Pas de coupures Zigbee répétées (RSSI > 100 minimum)
- Pas d'alertes parasites (mauvais réglage de seuil)
- Pile reste OK (battery_state = "high" pendant des mois)

## Troubleshooting

### Z2M crashe avec "Failed to connect to adapter"

Le dongle n'est pas accessible. Vérifier :
```bash
ls -la /dev/serial/by-id/
ls -la /dev/ttyUSB* /dev/ttyACM*
```
Si le path dans `.env` ne correspond pas, mettre à jour `ZIGBEE_DONGLE_PATH`.

### Bridge crashe avec "Node.js 20 detected without native WebSocket support"

Tu utilises l'ancienne image Node 20. Vérifie `docker-compose.yml` : la ligne doit être `image: node:22-alpine` pour `mqtt-bridge`.

### Bridge dit "Loaded 0 active sensors"

Les sondes ne sont pas dans `haccp_sensors` côté Supabase pour ce `HOTEL_ID`. Vérifier :
```sql
SELECT * FROM haccp_sensors WHERE hotel_id = 'f9d59e56-9a2f-433e-bcf4-f9753f105f32';
```

### Aucun relevé n'arrive en BDD malgré "Loaded 5 active sensors"

Sniffer MQTT pour voir si Z2M reçoit bien des messages :
```bash
sudo docker compose exec mosquitto mosquitto_sub -t 'zigbee2mqtt/#' -v
```
- Si rien ne s'affiche : les sondes ne communiquent pas (problème radio, piles, ou réseau Zigbee perdu)
- Si des messages arrivent mais pas en BDD : check les logs du bridge pour les erreurs d'insert

### Le réseau Zigbee a été perdu (sondes non reconnues)

Si quelqu'un a supprimé `zigbee2mqtt/data/database.db` ou `coordinator_backup.json`, il faudra re-appairer chaque sonde manuellement. Procédure dans `README.md` (section "Appairer une nouvelle sonde").

## Sécurité

- Le `.env` contient `SUPABASE_SERVICE_KEY` (clé service_role) — **ne jamais commit ni partager**
- Les ports `1883` (MQTT) et `8080` (Z2M frontend) **ne doivent jamais être exposés sur Internet** — LAN only
- Le bridge ne fait que des `INSERT` dans `haccp_readings` et `haccp_alerts`, jamais de `SELECT` sur tables sensibles
