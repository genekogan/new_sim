# Mars: Mimos tea-room mat, October 17 (M2 residual)

`marsland-parity.md` item 6: the reference (and the old /w/mars) cover the floor of Mimos's glazed tea room with a dark
continuous ground mat; on the new engine the room showed pale desert ground. One world-local flat def
(`mars-tea-room-mat@1`, 7.1 x 3.85 m, layer surface, no collider) in Mimos's frame over the `floor` room polygon. Colour
matched to the old world's rendered floor in the comparison view (old 59,59,46 / new 63,60,47 at dpr 1).

Tool and procedure: `tools/mars-rotation/add-patch.mjs` as for `../mars-field-20261016` (review -> preview -> `--apply`;
`--recover`; `--rollback [--apply]`). Placed in Mimos's frame, so it follows the campus rotation.
Local proof: copy of live (`tools/mars-m2/local-copy.mjs`), apply and rollback accepted; comparison view
`mimos-lounge-interior` refreshed. Not live-proven.
