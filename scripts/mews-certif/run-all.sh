#!/usr/bin/env bash
# Rejoue les cinq sondes sur la démo Mews, d'affilée.
#
#   ./scripts/mews-certif/run-all.sh
#
# À lancer le MATIN DE LA REVUE (14/07). Mews certifie en relisant ses journaux
# d'appels : des traces datant de la veille se retrouvent noyées sous 24 h de
# bruit des autres développeurs, qui tapent tous sur le même bac à sable public.
# Rejouer le jour J remet nos appels en tête de liste, sous le nom de client
# « Hotel Les Voiles Integration INT004073 ».
#
# Aucun risque pour la prod : chaque sonde refuse de démarrer si MEWS_BASE ne
# pointe pas la démo (garde-fou dans lib.mjs).

set -uo pipefail
cd "$(dirname "$0")/../.."

ENV_FILE=".env.mews-demo"
[ -f "$ENV_FILE" ] || { echo "Fichier $ENV_FILE introuvable — impossible de viser la démo."; exit 1; }

TOTAL_OK=0
TOTAL=0

for sonde in sweep-read sweep-write sweep-plus sweep-gaps sweep-final; do
  echo ""
  echo "══════ $sonde ══════"
  # On garde la dernière ligne de score (« 47/47 OK → … ») pour le bilan.
  out=$(node --env-file="$ENV_FILE" "scripts/mews-certif/$sonde.mjs" 2>&1)
  echo "$out"
  score=$(echo "$out" | grep -oE '^[0-9]+/[0-9]+' | tail -1)
  if [ -n "$score" ]; then
    ok=${score%/*}; tot=${score#*/}
    TOTAL_OK=$((TOTAL_OK + ok)); TOTAL=$((TOTAL + tot))
  fi
done

echo ""
echo "═══════════════════════════════════"
echo "  BILAN : $TOTAL_OK / $TOTAL appels en succès"
echo "  Les échecs attendus (et documentés dans le brief) :"
echo "    · cancellationPolicies/getAll  → bug Mews (contourné par getByRates)"
echo "    · accountNotes/update          → 500 constant chez Mews"
echo "    · payments/addCreditCard       → carte non activée sur la démo"
echo "═══════════════════════════════════"
