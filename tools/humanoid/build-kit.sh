#!/bin/sh
# Rebuild the humanoid@2 kit: Blender headless exports each character .blend's skinned parts, then
# build-kit.mjs writes mars/viewer/public/modular/humanoid/ (rigs, parts, kit.json) and the def's part enums.
#   tools/humanoid/build-kit.sh [SOURCE_DIR ...]
# Each SOURCE_DIR holds Quaternius "Ultimate Modular" .blend files, flat or under men/ and women/ (men → the masc
# frame, women → the fem frame). The Mars appearance research folder (read-only, not in the repo) has the three
# hand-mapped characters (Casual_2, Punk, Woman_Casual). The other 18 CC0 characters go in
#   .lane/quaternius-blends/men/*.blend and .lane/quaternius-blends/women/*.blend
# (Quaternius Drive, "Individual Characters/Blends"), then:
#   tools/humanoid/build-kit.sh <appearance-research-dir> <quaternius-blends-dir>   (the blends extracted from the Ultimate Modular Men/Women zips)
# New characters get automatic part ids and palette slots (build-kit.mjs autoCharacter); one whose skeleton is not
# a frame's bind pose is skipped and named. Check the result in the lab (README.md) before committing the kit.
set -eu
here=$(cd "$(dirname "$0")" && pwd); root=$(cd "$here/../.." && pwd)
[ $# -gt 0 ] || { echo "usage: build-kit.sh SOURCE_DIR ... (e.g. the Mars appearance research folder; not in the repo)" >&2; exit 2; }
blender=$(command -v blender || { [ -x /opt/homebrew/bin/blender ] && echo /opt/homebrew/bin/blender; } || echo /Applications/Blender.app/Contents/MacOS/Blender)
out="$root/.lane/t2/src"; rm -rf "$out"; mkdir -p "$out"   # fresh: a removed source never lingers in the kit
frames="$out/frames.json"; echo '{' > "$frames.tmp"; sep=''
done_names=' '
export_one() { # $1 = .blend, $2 = frame, $3 = name prefix (women/ → Woman_, so the packs' shared names stay distinct)
  name="${3:-}$(basename "$1" .blend)"
  case "$name" in Woman_Woman_*) name=${name#Woman_};; esac
  case "$done_names" in *" $name "*)
    # one character per name: the hand-mapped Casual_2/Punk/Woman_Casual (research folder, listed first) win over the
    # packs' copies of the same character (men/Casual_2, men/Punk; women/Casual = Woman_Casual in the newer rig)
    echo "kept $(cat "$out/.src-$name") for $name; skipped $1"; return 0;;
  esac
  rm -f "$out/$name.glb"
  "$blender" -b "$1" --python "$here/export_parts.py" -- "$out/$name.glb" 2>&1 | grep EXPORTED || { echo "export failed: $1"; return 0; }
  printf '%s "%s": "%s"' "$sep" "$name" "$2" >> "$frames.tmp"; sep=','
  printf '%s' "$1" > "$out/.src-$name"; done_names="$done_names$name "
}
for src in "$@"; do
  for f in "$src"/*.blend; do [ -f "$f" ] || continue; case $(basename "$f") in Woman*) export_one "$f" fem;; *) export_one "$f" masc;; esac; done
  for f in "$src"/men/*.blend; do [ -f "$f" ] && export_one "$f" masc; done
  for f in "$src"/women/*.blend; do [ -f "$f" ] && export_one "$f" fem Woman_; done
done
echo ' }' >> "$frames.tmp"; mv "$frames.tmp" "$frames"
node "$here/build-kit.mjs" --parts "$out/"
