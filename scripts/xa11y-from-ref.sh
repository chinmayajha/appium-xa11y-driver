#!/bin/bash
# Usage: scripts/xa11y-from-ref.sh <owner/repo@ref>
# Replaces the pinned xa11y with a build of the ref, for a CI run that needs an unreleased fix.
set -euo pipefail
spec=$1
repo=${spec%@*}
ref=${spec#*@}
if [ "$repo" = "$spec" ] || [ -z "$ref" ]; then
  echo "xa11y_ref takes owner/repo@ref, not '$spec'" >&2
  exit 2
fi
driver=$PWD
src=$(mktemp -d)
git clone --quiet --filter=blob:none "https://github.com/$repo.git" "$src"
git -C "$src" checkout --quiet "$ref"
echo "xa11y from $repo at $(git -C "$src" rev-parse HEAD)"
cd "$src/xa11y-js"
npm ci --no-audit --no-fund
npm run build
# The published package takes its binary from a platform package, so the pack must carry the local build.
npm pkg set 'files[]=*.node'
tgz=$(npm pack --silent)
tar -tzf "$tgz" | grep '\.node$' > /dev/null
cd "$driver"
npm install --no-save --no-audit --no-fund "$src/xa11y-js/$tgz"
npm run build
node "$driver/scripts/xa11y-loaded.mjs" "$driver" "$src/xa11y-js"
