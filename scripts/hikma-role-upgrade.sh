#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT="$HOME/biztrack-pro-hikma"
cd "$ROOT"

STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="scripts/backups/role-upgrade-$STAMP"

echo "=============================================="
echo " HIKMA — ROLE & RECORD CONTROL UPGRADE"
echo "=============================================="

echo
echo "[1/8] Repository safety check"
if [ -n "$(git status --short)" ]; then
  echo "Working tree is not clean:"
  git status --short
  echo
  echo "Stopping. Commit/stash unrelated changes first."
  exit 1
fi

echo
echo "[2/8] Creating backup"
mkdir -p "$BACKUP"
cp frontend/index.html "$BACKUP/frontend-index.html"
cp -r server/src "$BACKUP/server-src"
echo "Backup: $BACKUP"

echo
echo "[3/8] Verifying role model"
grep -n 'Role = "CEO" | "Manager" | "Staff"' server/src/types.ts

echo
echo "[4/8] Verifying authentication controls"
grep -nE 'requireRole|role ===|role !==' server/src/auth.ts server/src/routes/auth.ts || true

echo
echo "[5/8] Verifying current record APIs"
echo "--- Products ---"
grep -nE 'productsRoutes\.(get|post|put|delete)' server/src/routes/products.ts || true

echo "--- Sales ---"
grep -nE 'salesRoutes\.(get|post|put|delete)' server/src/routes/sales.ts || true

echo "--- Purchases ---"
grep -nE 'purchasesRoutes\.(get|post|put|delete)' server/src/routes/purchases.ts || true

echo "--- CRUD ---"
grep -nE 'app\.(get|post|put|delete)' server/src/crud.ts || true

echo
echo "[6/8] Checking frontend record actions"
grep -nE 'deleteProduct|deleteCrud|submitSale|openSale|pqty|qty|quantity' \
  frontend/index.html | head -120

echo
echo "[7/8] Server build"
cd server
npm run build

echo
echo "[8/8] Final audit"
cd "$ROOT"

echo
echo "=== STATUS ==="
git status --short

echo
echo "=== DIFF STATISTICS ==="
git diff --stat

echo
echo "=============================================="
echo " AUDIT COMPLETE"
echo "=============================================="
echo
echo "The upgrade macro intentionally stopped before"
echo "modifying production code."
echo
echo "Backup:"
echo "$BACKUP"
echo
echo "Current baseline:"
git log --oneline -1
