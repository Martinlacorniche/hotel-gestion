#!/bin/bash
# ============================================================================
# install.sh — Déploiement automatisé de la stack HACCP sur un mini-PC Linux
# ============================================================================
# Usage : ./install.sh
# Pré-requis : être dans le dossier agent_zigbee/, dongle Sonoff branché.
# ============================================================================

set -e

cd "$(dirname "$0")"

echo "======================================"
echo "  HACCP — Installation mini-PC"
echo "======================================"
echo ""

# ----------------------------------------------------------------------------
# 1) Vérification du système
# ----------------------------------------------------------------------------
if ! command -v apt-get >/dev/null 2>&1; then
  echo "❌ Ce script suppose Debian/Ubuntu (apt-get manquant). Adapte manuellement pour ton OS."
  exit 1
fi

# ----------------------------------------------------------------------------
# 2) Installation Docker si absent
# ----------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "→ Docker absent, installation en cours..."
  sudo apt-get update
  sudo apt-get install -y docker.io docker-compose-v2
  sudo usermod -aG docker "$USER"
  echo "✅ Docker installé."
  echo "⚠️  Tu viens d'être ajouté au groupe 'docker'. Pour cette session, utilise 'sudo' devant les commandes Docker."
  echo "   Pour rendre le groupe permanent : logout/login (ou 'newgrp docker')."
  echo ""
else
  echo "→ Docker déjà installé : $(docker --version)"
fi

# ----------------------------------------------------------------------------
# 3) Détection du dongle Sonoff
# ----------------------------------------------------------------------------
DONGLE=$(ls /dev/serial/by-id/usb-Itead_Sonoff_Zigbee_3.0_USB_Dongle_Plus* 2>/dev/null | head -1)
if [ -z "$DONGLE" ]; then
  echo "❌ Aucun dongle Sonoff trouvé sous /dev/serial/by-id/"
  echo "   Vérifie :"
  echo "   - que le dongle est bien branché en USB"
  echo "   - 'lsusb | grep -i itead' montre quelque chose"
  echo "   - 'dmesg | tail' affiche un device récent"
  exit 1
fi
echo "→ Dongle détecté : $DONGLE"

# Mise à jour du .env si le path actuel ne correspond pas
if grep -q "^ZIGBEE_DONGLE_PATH=$DONGLE$" .env 2>/dev/null; then
  echo "→ Path du dongle déjà à jour dans .env"
else
  echo "→ Mise à jour de ZIGBEE_DONGLE_PATH dans .env"
  sed -i "s|^ZIGBEE_DONGLE_PATH=.*|ZIGBEE_DONGLE_PATH=$DONGLE|" .env
fi

# ----------------------------------------------------------------------------
# 4) Vérification de la présence des fichiers critiques
# ----------------------------------------------------------------------------
for f in .env docker-compose.yml bridge/index.js mosquitto/config/mosquitto.conf zigbee2mqtt/data/configuration.yaml; do
  if [ ! -f "$f" ]; then
    echo "❌ Fichier manquant : $f — le dossier n'est pas complet."
    exit 1
  fi
done

if [ ! -f "zigbee2mqtt/data/database.db" ]; then
  echo "⚠️  Pas de zigbee2mqtt/data/database.db — les sondes ne sont pas pré-appairées."
  echo "   Tu démarreras un réseau Zigbee vide, et il faudra appairer les 5 sondes manuellement"
  echo "   via le frontend Z2M (http://localhost:8080) une par une."
  echo ""
  read -p "Continuer quand même ? [y/N] " yn
  [ "$yn" = "y" ] || [ "$yn" = "Y" ] || exit 1
else
  echo "→ Base Z2M trouvée (sondes pré-appairées préservées) ✅"
fi

# ----------------------------------------------------------------------------
# 5) Lancement de la stack
# ----------------------------------------------------------------------------
echo ""
echo "→ Pull des images Docker (peut prendre 1-2 min au premier run)..."
sudo docker compose pull

echo ""
echo "→ Lancement de la stack..."
sudo docker compose up -d

echo ""
echo "→ Attente de 15s pour l'initialisation..."
sleep 15

echo ""
echo "======================================"
echo "  Logs Zigbee2MQTT (dernières lignes)"
echo "======================================"
sudo docker compose logs --tail=30 zigbee2mqtt

echo ""
echo "======================================"
echo "  Logs Bridge (dernières lignes)"
echo "======================================"
sudo docker compose logs --tail=20 mqtt-bridge

echo ""
echo "======================================"
echo "✅ Installation terminée."
echo ""
echo "Points à vérifier dans les logs ci-dessus :"
echo "  - Z2M : 'Coordinator firmware version' + 'Zigbee2MQTT started!'"
echo "  - Bridge : 'Loaded 5 active sensors' + 'Subscribed to zigbee2mqtt/+'"
echo ""
echo "Frontend Z2M accessible sur : http://localhost:8080"
echo "(ou http://<ip-mini-pc>:8080 depuis le LAN)"
echo ""
echo "Dans 5-10 min, vérifie côté Supabase qu'au moins 1 relevé est arrivé"
echo "par sonde — cf. requête SQL dans INSTALL.md."
echo "======================================"
