# agent_zigbee — Passerelle HACCP

Stack Docker à déployer sur le **mini-PC Linux de chaque hôtel** (Corniche en POC).
Ingère les relevés des sondes Zigbee Tuya ZT01 via le dongle Sonoff ZBDongle-E
et les pousse dans Supabase (`haccp_readings`).

## Composants

| Service | Rôle | Port |
|---|---|---|
| **mosquitto** | Broker MQTT local | 1883 (LAN only) |
| **zigbee2mqtt** | Pont Zigbee↔MQTT + frontend web admin | 8080 (LAN only) |
| **mqtt-bridge** | Subscriber Node.js qui forwarde vers Supabase | — |

## Prérequis sur le mini-PC

- Linux Debian/Ubuntu
- Docker + docker-compose installés
- Dongle Sonoff ZBDongle-E branché en USB
- Accès Internet sortant (HTTPS vers Supabase)

## Premier déploiement (Corniche)

```bash
# 1) Cloner ce dossier sur le mini-PC
cd ~ && git clone <repo> siteconsignes
cd siteconsignes/agent_zigbee

# 2) Identifier le device path du dongle
ls -la /dev/serial/by-id/
# devrait montrer un truc style usb-Itead_Sonoff_Zigbee_3.0_USB_Dongle_Plus_xxx
# Si /dev/ttyACM0 standard suffit, OK.

# 3) Préparer l'environnement
cp .env.example .env
# Remplir : HOTEL_ID (UUID Corniche), SUPABASE_URL, SUPABASE_SERVICE_KEY

# 4) Lancer la stack
docker compose up -d

# 5) Vérifier les logs
docker compose logs -f zigbee2mqtt
docker compose logs -f mqtt-bridge
```

## Appairer une nouvelle sonde

1. Aller sur `http://<ip-mini-pc>:8080` (frontend Zigbee2MQTT) depuis un PC du LAN
2. Cliquer **Permit join (All)** (durée 254 s)
3. Sur la sonde Tuya ZT01 : appui long sur le bouton reset jusqu'à clignotement
4. La sonde apparaît dans la liste → la renommer (ex: `frigo_gauche`)
5. **Désactiver Permit join** immédiatement après
6. Côté siteconsignes (admin) : créer une ligne dans `haccp_sensors` avec :
   - `friendly_name` = exactement le nom Z2M (`frigo_gauche`)
   - `zigbee_address` = l'IEEE address (vu dans Z2M)
   - `location`, `sensor_type`, `temp_min`, `temp_max`, `alert_delay_min`
7. À la prochaine reload du bridge (≤ 5 min), les relevés commencent à remonter

## Sécurité

- **Ne jamais exposer** les ports 1883 / 8080 / 9001 sur Internet (LAN only)
- La clé `SUPABASE_SERVICE_KEY` doit rester dans `.env` (gitignored)
- Le bridge ne fait que des INSERT dans `haccp_readings`, jamais de SELECT sur tables sensibles

## Maintenance

- Logs : `docker compose logs -f`
- Restart : `docker compose restart`
- Mise à jour : `docker compose pull && docker compose up -d`
- Sauvegarde Z2M (clé réseau, appairages) : backup régulier de `./zigbee2mqtt/data/`
