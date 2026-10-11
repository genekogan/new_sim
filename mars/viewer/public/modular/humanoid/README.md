# humanoid@2 kit (Eden `core/humanoid@2` looks)

Built by `tools/humanoid/build-kit.sh` (Blender headless export → `tools/humanoid/build-kit.mjs`); manifest `kit.json`
(per part: tris, bytes, sha256, licence, landmarks). Composed in the viewer by `apps/web/src/humanoid/compose.ts`.

- `rig-masc.glb`, `rig-fem.glb`: one skeleton each (the casual/punk and the woman bind poses) with the 51 shared
  clips (Quaternius' 8 + 43 Universal Animation Library clips as shipped in `../environment/animated-*.glb`).
- `parts/<slot>-<id>.<frame>.glb`: 15 skinned parts (face, hair, top, bottom, shoes × 3) in both frames.
- Hats, glasses and bags are built in code (`apps/web/src/humanoid/props.ts`); patterns are procedural (no textures).

## Licences

| Source | Licence | Used for |
|---|---|---|
| Quaternius, *Ultimate Modular Men* and *Ultimate Modular Women* packs (quaternius.com): `Casual_2.blend`, `Punk.blend`, `Woman_Casual.blend` | CC0 1.0 (public domain) | every part and both rigs |
| Quaternius, *Universal Animation Library* clips (as already shipped in the Mars animated people) | CC0 1.0 | the 43 UAL clips in the rigs |
| Eden (this repo) | repo licence | props, palette/pattern shader, the build pipeline |

No attribution is required by CC0; we credit Quaternius anyway. The other 18 characters of the two packs (also CC0)
are not on this laptop yet: put their `.blend` files in `.lane/quaternius-blends/{men,women}/` and run
`tools/humanoid/build-kit.sh <appearance dir> .lane/quaternius-blends` (see the script header).
