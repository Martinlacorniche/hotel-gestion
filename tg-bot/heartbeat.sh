#!/usr/bin/env bash
# Battement de cœur du serveur Corniche → Supabase (table machine_watch).
# Lancé par cron toutes les minutes. Un silence de plus de `seuil_sec` déclenche
# l'alerte Telegram côté Supabase (pg_cron). Voir db/migrations/100 et 101.
set -uo pipefail

ENV_FILE=/home/htbm/haccp-corniche-20260525/agent_zigbee/.env
ID=serveur-corniche

SUPABASE_URL=$(grep -E '^SUPABASE_URL=' "$ENV_FILE" | cut -d= -f2-)
KEY=$(grep -E '^SUPABASE_SERVICE_KEY=' "$ENV_FILE" | cut -d= -f2-)
[ -n "$SUPABASE_URL" ] && [ -n "$KEY" ] || { echo "$(date -Is) .env illisible" >&2; exit 1; }

# `systemctl is-active` et `docker inspect` ne demandent pas les droits root.
svc() { systemctl is-active --quiet "$1" && echo true || echo false; }
cnt() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = 'true' ] && echo true || echo false; }

NOW=$(date -Is -u)
DETAIL=$(printf '{"zigbee2mqtt":%s,"mqtt_bridge":%s,"mosquitto":%s,"chromecast":%s,"screen_relay":%s,"uptime_sec":%s,"load1":%s,"disk_pct":%s}' \
  "$(cnt haccp-zigbee2mqtt)" "$(cnt haccp-mqtt-bridge)" "$(cnt haccp-mosquitto)" \
  "$(svc chromecast-hotel)" "$(svc screen-relay)" \
  "$(cut -d. -f1 /proc/uptime)" "$(awk '{print $1}' /proc/loadavg)" \
  "$(df --output=pcent / | tail -1 | tr -dc '0-9')")

curl -sS -m 25 -o /dev/null -X PATCH "$SUPABASE_URL/rest/v1/machine_watch?id=eq.$ID" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=minimal" \
  -d "{\"last_seen\":\"$NOW\",\"detail\":$DETAIL,\"updated_at\":\"$NOW\"}" \
  || { echo "$(date -Is) envoi Supabase KO" >&2; exit 1; }
