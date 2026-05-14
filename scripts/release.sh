#!/usr/bin/env bash
set -euo pipefail
trap 'echo "[release] failed at line $LINENO"; exit 1' ERR

VERSION=$(node -e "console.log(require('./package.json').version)")
echo "[release] building $VERSION"
npm run build

echo "[release] validating MSI config"
node scripts/validate-msi-config.js

echo "[release] packaging MSI"
npx electron-builder

if [ ! -d release ]; then
  echo "[release] ERROR: release/ directory missing after electron-builder" >&2
  exit 1
fi

echo "[release] generating latest.yml"
node scripts/generate-latest-yml.js

if [ ! -f release/latest.yml ]; then
  echo "[release] ERROR: release/latest.yml not generated" >&2
  exit 1
fi

echo "[release] publishing to GitHub"
npx electron-builder --publish always -c.publish.releaseType=release

gh release upload "v${VERSION}" release/latest.yml --clobber
echo "[release] done"
