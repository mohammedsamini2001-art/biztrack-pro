#!/data/data/com.termux/files/usr/bin/bash
set -e

ROOT="$HOME/biztrack-pro-hikma"
cd "$ROOT"

STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="scripts/backups/macro-$STAMP"

echo "========================================"
echo " HIKMA BUSINESS OS — MAINTENANCE MACRO"
echo "========================================"
echo

echo "[1/7] Checking repository..."
git status --short

echo
echo "[2/7] Creating safety backup..."
mkdir -p "$BACKUP"
cp frontend/index.html "$BACKUP/frontend-index.html"
cp -r server/src "$BACKUP/server-src"

echo "Backup: $BACKUP"

echo
echo "[3/7] Checking role model..."
grep -n 'Role = "CEO" | "Manager" | "Staff"' server/src/types.ts || true
grep -n 'requireRole' server/src/routes/auth.ts || true

echo
echo "[4/7] Checking delete capabilities..."
grep -RniE 'delete|DELETE|remove|Remove' \
  frontend/index.html server/src \
  --exclude-dir=node_modules \
  --exclude='*.backup-*' | head -100

echo
echo "[5/7] Building server..."
cd server
npm run build

echo
echo "[6/7] Returning to project..."
cd "$ROOT"

echo
echo "[7/7] Showing proposed state..."
git status --short

echo
echo "========================================"
echo " MACRO CHECK COMPLETE"
echo "========================================"
echo "No files were automatically modified."
echo "Backup created at:"
echo "$BACKUP"
