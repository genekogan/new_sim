#!/bin/sh
# Rebuild the humanoid@2 kit: Blender headless exports each character .blend's skinned parts, then
# build-kit.mjs writes mars/viewer/public/modular/humanoid/ (rigs, parts, kit.json) and the def's part enums.
#   tools/humanoid/build-kit.sh [SOURCE_DIR ...]
# Each SOURCE_DIR holds Quaternius "Ultimate Modular" .blend files, flat or under men/ and women/ (men → the masc
# frame, women → the fem frame). Default: the Mars appearance research folder (read-only), which has the three
# hand-mapped characters (Casual_2, Punk, Woman_Casual). The other 18 CC0 characters go in
#   .lane/quaternius-blends/men/*.blend and .lane/quaternius-blends/women/*.blend
# (Quaternius Drive, "Individual Characters/Blends"), then:
#   tools/humanoid/build-kit.sh <mars-media>/reconstruction/2026-campus/modular/research/appearance .lane/quaternius-blends
# New characters get automatic part ids and palette slots (build-kit.mjs autoCharacter); one whose skeleton is not
# a frame's bind pose is skipped and named. Check the result in the lab (README.md) before committing the kit.
set -eu
here=$(cd "$(dirname "$0")" && pwd); root=$(cd "$here/../.." && pwd)
[ $# -gt 0 ] || set -- "<mars-media>/reconstruction/2026-campus/modular/research/appearance"
blender=$(command -v blender || echo /Applications/Blender.app/Contents/MacOS/Blender)
out="$root/.lane/t2/src"; mkdir -p "$out"
frames="$out/frames.json"; echo '{' > "$frames.tmp"; sep=''
export_one() { # $1 = .blend, $2 = frame
  name=$(basename "$1" .blend)
  "$blender" -b "$1" --python "$here/export_parts.py" -- "$out/$name.glb" 2>&1 | grep EXPORTED || { echo "export failed: $1"; return 0; }
  printf '%s "%s": "%s"' "$sep" "$name" "$2" >> "$frames.tmp"; sep=','
}
for src in "$@"; do
  for f in "$src"/*.blend; do [ -f "$f" ] || continue; case $(basename "$f") in Woman*) export_one "$f" fem;; *) export_one "$f" masc;; esac; done
  for f in "$src"/men/*.blend; do [ -f "$f" ] && export_one "$f" masc; done
  for f in "$src"/women/*.blend; do [ -f "$f" ] && export_one "$f" fem; done
done
echo ' }' >> "$frames.tmp"; mv "$frames.tmp" "$frames"
node "$here/build-kit.mjs" --parts "$out/"
