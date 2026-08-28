#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT="$HOME/biztrack-pro-hikma"
cd "$ROOT"

STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="scripts/backups/auto-upgrade-$STAMP"

echo "=============================================="
echo " HIKMA — AUTOMATIC SAFE UPGRADE"
echo "=============================================="

echo
echo "[1/9] Checking repository"

if [ -n "$(git status --short)" ]; then
  echo "ERROR: Working tree is not clean."
  git status --short
  echo
  echo "Commit or stash changes before running the upgrade."
  exit 1
fi

echo "Repository clean."

echo
echo "[2/9] Creating safety backup"

mkdir -p "$BACKUP"
cp frontend/index.html "$BACKUP/frontend-index.html"
cp -r server/src "$BACKUP/server-src"

echo "Backup created:"
echo "$BACKUP"

echo
echo "[3/9] Capturing baseline"

BASELINE=$(git rev-parse HEAD)
echo "Baseline: $BASELINE"

echo
echo "[4/9] Running pre-upgrade build"

cd server
npm run build
cd "$ROOT"

echo
echo "[5/9] Applying automatic upgrade"

node <<'NODE'
const fs = require("fs");

const file = "frontend/index.html";
let s = fs.readFileSync(file, "utf8");

function replaceOnce(oldText, newText, label) {
  const count = s.split(oldText).length - 1;

  if (count !== 1) {
    throw new Error(
      `${label}: expected exactly 1 match, found ${count}`
    );
  }

  s = s.replace(oldText, newText);
  console.log(`  ✓ ${label}`);
}

/*
 * SAFETY:
 * We only modify exact known sections.
 * If the source has changed, the macro stops instead
 * of guessing and corrupting the file.
 */

replaceOnce(
  "async function deleteProduct(id){if(!confirm('Delete this product?'))return;",
  "async function deleteProduct(id){if(!currentUser||!['CEO','Manager'].includes(currentUser.role)){toast('Only CEO or Manager can delete records.');return;}if(!confirm('Delete this product?'))return;",
  "Protect product deletion"
);

replaceOnce(
  "async function deleteCrud(col,id){if(!confirm('Delete this record?'))return;",
  "async function deleteCrud(col,id){if(!currentUser||!['CEO','Manager'].includes(currentUser.role)){toast('Only CEO or Manager can delete records.');return;}if(!confirm('Delete this record?'))return;",
  "Protect generic record deletion"
);

fs.writeFileSync(file, s);
NODE

echo
echo "[6/9] Running post-upgrade build"

cd server
npm run build
cd "$ROOT"

echo
echo "[7/9] Inspecting changes"

git diff -- frontend/index.html

echo
echo "[8/9] Final safety checks"

if ! grep -q "Only CEO or Manager can delete records" frontend/index.html; then
  echo "ERROR: Upgrade marker not found."
  echo "Restoring backup..."

  cp "$BACKUP/frontend-index.html" frontend/index.html

  echo "Rollback complete."
  exit 1
fi

cd server
npm run build
cd "$ROOT"

echo
echo "[9/9] Upgrade complete"

echo "=============================================="
echo " HIKMA AUTOMATIC UPGRADE PASSED"
echo "=============================================="

echo
echo "Baseline:"
echo "$BASELINE"

echo
echo "Backup:"
echo "$BACKUP"

echo
echo "Git status:"
git status --short

echo
echo "Diff statistics:"
git diff --stat

echo
echo "IMPORTANT:"
echo "No commit or push was performed."
echo "Review the diff before checkpointing."
