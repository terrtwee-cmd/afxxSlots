#!/usr/bin/env bash
# =====================================================================
#  AFXX - actualizar el sitio (Linux / macOS)
#
#  IMPORTANTE: despues del commit de limpieza, .env y data.json dejan de
#  estar versionados. Un "git pull" a mano te BORRA esos dos archivos del
#  disco (son la configuracion y la base de datos). Este script los
#  respalda antes del pull y los restaura despues.
#
#  Uso:  bash tools/actualizar.sh
# =====================================================================
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$REPO/backend/_backup"

echo
echo " ============================================"
echo "   AFXX - actualizar a la ultima version"
echo " ============================================"
echo

echo " [1/5] Respaldando .env y data.json..."
mkdir -p "$BACKUP"
[ -f backend/.env ]      && cp -p backend/.env      "$BACKUP/.env.$STAMP"      && echo "       .env respaldado"
[ -f backend/data.json ] && cp -p backend/data.json "$BACKUP/data.json.$STAMP" && echo "       data.json respaldado"
echo

echo " [2/5] Descargando cambios de GitHub..."
git pull origin main
echo

echo " [3/5] Restaurando .env y data.json si git los borro..."
[ -f backend/.env ]      || { [ -f "$BACKUP/.env.$STAMP" ]      && cp -p "$BACKUP/.env.$STAMP"      backend/.env      && echo "       .env restaurado"; } || true
[ -f backend/data.json ] || { [ -f "$BACKUP/data.json.$STAMP" ] && cp -p "$BACKUP/data.json.$STAMP" backend/data.json && echo "       data.json restaurado"; } || true
echo

echo " [4/5] Comprobando dependencias..."
[ -d node_modules/dotenv ]        || { echo "       instalando raiz..."; npm install --no-audit --no-fund; }
[ -d backend/node_modules/express ] || { echo "       instalando backend..."; (cd backend && npm install --no-audit --no-fund); }
echo

echo " [5/5] Reiniciando el backend..."
pkill -f "node server.js" 2>/dev/null || true
sleep 1
(cd backend && nohup node server.js > "$BACKUP/server.log" 2>&1 &)
sleep 2
echo "       Backend arrancado en http://localhost:4000"
echo
echo " ============================================"
echo "   Listo. El sitio ya esta actualizado."
echo " ============================================"
echo
echo " RECORDATORIO: al reiniciar tu tunel de Cloudflare la URL cambia."
echo " Actualizala en Render: servicio > Environment > TARGET_URL."
echo " Respaldo de esta actualizacion: backend/_backup/"
echo
