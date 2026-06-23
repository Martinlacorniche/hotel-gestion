#!/usr/bin/env bash
# Sauvegarde complète de la BDD Supabase (projet consignes)
# Usage : ./backups/backup.sh
# Le mot de passe Postgres est demandé en interactif (Dashboard > Settings > Database).
set -euo pipefail
cd "$(dirname "$0")/.."

stamp=$(date +%Y%m%d_%H%M%S)
dir="backups/$stamp"
mkdir -p "$dir"

echo ">> Sauvegarde dans $dir"
echo ">> 1/3 rôles..."
supabase db dump --linked --role-only -f "$dir/roles.sql"
echo ">> 2/3 schéma..."
supabase db dump --linked            -f "$dir/schema.sql"
echo ">> 3/3 données..."
supabase db dump --linked --data-only --use-copy -f "$dir/data.sql"

echo ">> Terminé :"
ls -lh "$dir"
