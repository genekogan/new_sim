#!/bin/sh
# Rebuild the humanoid@2 kit: Blender headless exports each character .blend's skinned parts, then
# build-kit.mjs writes mars/viewer/public/modular/humanoid/ (rigs, parts, kit.json).
#   tools/humanoid/build-kit.sh [SOURCE_DIR]
# SOURCE_DIR holds the Quaternius "Ultimate Modular" .blend files (default: the Mars appearance research folder,
# read-only). Add more characters by dropping their .blend files there and a CHARACTERS row in build-kit.mjs.
set -eu
here=$(cd "$(dirname "$0")" && pwd); root=$(cd "$here/../.." && pwd)
src=${1:-<mars-media>/reconstruction/2026-campus/modular/research/appearance}
blender=$(command -v blender || echo /Applications/Blender.app/Contents/MacOS/Blender)
out="$root/.lane/t2/src"; mkdir -p "$out"
for f in Casual_2 Punk Woman_Casual; do
  [ -f "$src/$f.blend" ] || { echo "missing $src/$f.blend (build-kit falls back to the shipped GLB)"; continue; }
  "$blender" -b "$src/$f.blend" --python "$here/export_parts.py" -- "$out/$f.glb" 2>&1 | grep EXPORTED
done
node "$here/build-kit.mjs" --parts "$out/"
