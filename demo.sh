#!/usr/bin/env bash
# SIMCOVA — Lancement de la démonstration (Linux / macOS / Git Bash)
cd "$(dirname "$0")" || exit 1

echo "============================================================"
echo "  SIMCOVA Marketplace — Lancement de la démonstration"
echo "============================================================"

# Node >= 22.5 requis (node:sqlite) : système, sinon embarqué dans tools/node22, sinon TEMP
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
NODE_BIN="node"
if [ "$NODE_MAJOR" -lt 22 ]; then
  if [ -x "$(dirname "$0")/tools/node22/node.exe" ]; then
    NODE_BIN="$(dirname "$0")/tools/node22/node.exe"
  elif [ -x "$TEMP/node-v22.23.5-win-x64/node.exe" ] || [ -x "/tmp/node-v22.23.5-win-x64/node.exe" ]; then
    NODE_BIN="${TEMP:-/tmp}/node-v22.23.5-win-x64/node.exe"
  else
    echo "[ERREUR] Node.js >= 22.5 requis (node:sqlite). Installez-le : nvm install 22 && nvm use 22"
    exit 1
  fi
fi

[ -d node_modules/nodemailer ] || npm install --no-audit --no-fund

# Base de démo propre à chaque présentation
rm -f data/simcova-demo.db data/simcova-demo.db-wal data/simcova-demo.db-shm

echo "Comptes de démonstration :"
echo "  Admin    : admin@simcova.africa  /  AdminDemo2026!"
echo "  Vendeur  : vendeur@simcova.africa / VendeurDemo2026!"
echo "Plateforme sur http://localhost:3000 (Ctrl+C pour arrêter)"
exec "$NODE_BIN" node_modules/tsx/dist/cli.mjs server.ts
