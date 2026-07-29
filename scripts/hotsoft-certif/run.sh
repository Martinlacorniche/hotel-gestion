#!/usr/bin/env bash
# Lance une sonde HotSoft sur le bac à sable de certification.
#
#   bash scripts/hotsoft-certif/run.sh sweep-read.mjs
#   bash scripts/hotsoft-certif/run.sh import-dryrun.mjs
#
# Le client vit en TypeScript dans src/lib/hotsoft.ts, parce que c'est lui qui
# partira en production. Le Node de cette machine est compilé sans support
# TypeScript (ERR_NO_TYPESCRIPT), donc on transpile avant de lancer plutôt que
# d'entretenir une deuxième copie du client en .mjs.
set -euo pipefail
cd "$(dirname "$0")/../.."

SCRIPT="${1:-sweep-read.mjs}"

if [ ! -f .env.hotsoft-demo ]; then
  echo "REFUS : .env.hotsoft-demo introuvable (identifiants du bac à sable)." >&2
  exit 1
fi

./node_modules/.bin/tsc src/lib/hotsoft.ts \
  --outDir scripts/hotsoft-certif/.build \
  --module esnext --target es2022 --moduleResolution bundler --skipLibCheck

exec node --env-file=.env.hotsoft-demo "scripts/hotsoft-certif/$SCRIPT"
