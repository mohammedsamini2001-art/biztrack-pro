#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT="$HOME/biztrack-pro-hikma"
cd "$ROOT"

STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="scripts/backups/generic-delete-security-$STAMP"

echo "=============================================="
echo " HIKMA — GENERIC DELETE SECURITY UPGRADE"
echo "=============================================="

echo
echo "[1/9] Repository safety check"

if [ -n "$(git status --short)" ]; then
  echo "ERROR: Working tree is not clean."
  git status --short
  exit 1
fi

echo "Repository clean."

echo
echo "[2/9] Creating safety backup"

mkdir -p "$BACKUP"
cp -r server/src "$BACKUP/server-src"

echo "Backup: $BACKUP"

echo
echo "[3/9] Capturing baseline"

BASELINE=$(git rev-parse HEAD)
echo "Baseline: $BASELINE"

echo
echo "[4/9] Pre-upgrade build"

npm --prefix server run build

echo
echo "[5/9] Applying generic DELETE role protection"

node <<'NODE'
const fs = require("fs");

const file = "server/src/crud.ts";
let s = fs.readFileSync(file, "utf8");

if (!s.includes("requireRole")) {
  if (!s.includes('from "./auth"')) {
    throw new Error("crud.ts: cannot safely locate auth import");
  }

  s = s.replace(
    /import\s+\{([^}]*)\}\s+from\s+"\.\/auth";/,
    (m, imports) => {
      const list = imports
        .split(",")
        .map(x => x.trim())
        .filter(Boolean);

      if (!list.includes("requireRole")) {
        list.push("requireRole");
      }

      return `import { ${list.join(", ")} } from "./auth";`;
    }
  );
}

const oldText = 'app.delete("/:id", async (c) => {';
const newText = 'app.delete("/:id", requireRole("CEO", "Manager"), async (c) => {';

const count = s.split(oldText).length - 1;

if (count === 0) {
  if (s.includes(newText)) {
    console.log("  ✓ Generic DELETE already protected");
    process.exit(0);
  }

  throw new Error("crud.ts: generic DELETE route not found");
}

if (count !== 1) {
  throw new Error(`crud.ts: expected exactly 1 DELETE route, found ${count}`);
}

s = s.replace(oldText, newText);

fs.writeFileSync(file, s);

console.log("  ✓ Generic DELETE protected");
NODE

echo
echo "[6/9] Verifying route"

grep -nE 'app\.delete|requireRole' server/src/crud.ts

echo
echo "[7/9] Post-upgrade build"

npm --prefix server run build

echo
echo "[8/9] Safety verification"

if ! grep -q 'app.delete("/:id", requireRole("CEO", "Manager")' server/src/crud.ts; then
  echo "ERROR: Generic DELETE protection missing."
  echo "Rolling back..."

  rm -rf server/src
  cp -r "$BACKUP/server-src" server/src

  npm --prefix server run build

  echo "Rollback complete."
  exit 1
fi

echo "✓ Generic DELETE requires CEO/Manager"

echo
echo "[9/9] Showing diff"

git diff -- server/src/crud.ts

echo
echo "=============================================="
echo " GENERIC DELETE SECURITY UPGRADE PASSED"
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
echo "IMPORTANT:"
echo "No commit or push was performed."
