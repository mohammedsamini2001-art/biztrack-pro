#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT="$HOME/biztrack-pro-hikma"
cd "$ROOT"

STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="scripts/backups/server-delete-security-$STAMP"

echo "=============================================="
echo " HIKMA — SERVER DELETE SECURITY UPGRADE"
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
echo "[4/9] Pre-upgrade server build"

cd server
npm run build
cd "$ROOT"

echo
echo "[5/9] Applying server-side role protection"

node <<'NODE'
const fs = require("fs");

const files = [
  "server/src/routes/products.ts",
  "server/src/routes/purchases.ts"
];

function patchFile(file, routeName) {
  let s = fs.readFileSync(file, "utf8");

  if (!s.includes("requireRole")) {
    if (!s.includes('from "../auth"')) {
      throw new Error(
        `${file}: cannot safely locate auth import`
      );
    }

    s = s.replace(
      /import\s+\{([^}]*)\}\s+from\s+"\.\.\/auth";/,
      (m, imports) => {
        const list = imports
          .split(",")
          .map(x => x.trim())
          .filter(Boolean);

        if (!list.includes("requireRole")) {
          list.push("requireRole");
        }

        return `import { ${list.join(", ")} } from "../auth";`;
      }
    );
  }

  const patterns = [
    {
      old: `${routeName}Routes.delete("/:id", async (c) => {`,
      next: `${routeName}Routes.delete("/:id", requireRole("CEO", "Manager"), async (c) => {`
    }
  ];

  for (const p of patterns) {
    const count = s.split(p.old).length - 1;

    if (count === 0) {
      throw new Error(`${file}: expected delete route not found`);
    }

    if (count > 1) {
      throw new Error(`${file}: multiple delete routes found`);
    }

    if (s.includes(p.next)) {
      console.log(`  ✓ ${file}: already protected`);
      return s;
    }

    s = s.replace(p.old, p.next);
    console.log(`  ✓ ${file}: DELETE protected`);
  }

  fs.writeFileSync(file, s);
  return s;
}

patchFile("server/src/routes/products.ts", "products");
patchFile("server/src/routes/purchases.ts", "purchases");
NODE

echo
echo "[6/9] Auditing remaining DELETE endpoints"

echo "--- Products ---"
grep -nE 'delete\("/:id"' server/src/routes/products.ts || true

echo "--- Purchases ---"
grep -nE 'delete\("/:id"' server/src/routes/purchases.ts || true

echo "--- Generic CRUD ---"
grep -nE 'app\.delete\("/:id"' server/src/crud.ts || true

echo
echo "[7/9] Post-upgrade build"

cd server
npm run build
cd "$ROOT"

echo
echo "[8/9] Safety verification"

if ! grep -q 'productsRoutes.delete("/:id", requireRole("CEO", "Manager")' server/src/routes/products.ts; then
  echo "ERROR: Product deletion protection missing."
  echo "Rolling back..."
  rm -rf server/src
  cp -r "$BACKUP/server-src" server/src
  exit 1
fi

if ! grep -q 'purchasesRoutes.delete("/:id", requireRole("CEO", "Manager")' server/src/routes/purchases.ts; then
  echo "ERROR: Purchase deletion protection missing."
  echo "Rolling back..."
  rm -rf server/src
  cp -r "$BACKUP/server-src" server/src
  exit 1
fi

echo "✓ Product DELETE requires CEO/Manager"
echo "✓ Purchase DELETE requires CEO/Manager"

cd server
npm run build
cd "$ROOT"

echo
echo "[9/9] Showing diff"

git diff -- server/src/routes/products.ts server/src/routes/purchases.ts

echo
echo "=============================================="
echo " SERVER DELETE SECURITY UPGRADE PASSED"
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
