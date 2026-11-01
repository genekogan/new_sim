---
id: soul-portable-light
tier: regression
fixture: soul-actions-portable
mocks: []
critical_path: true
---
# A portable light and bowl keep one native clock through surface placement

## Steps
1. Pick up the lantern from the source table through the ordinary paired Soul CLI.
   - expect: it stays on the source until grasp, then its actual recorded pose follows the occupied hand; no duplicate native cube
   - screenshot: lantern-held.png
2. Wave while holding the lantern, then place it on the rotated destination table.
   - expect: free gesture preserves custody; displayed lamp, light-map pool and halo share the depicted position; no old glow, premature reparent or release snap
   - screenshot: lantern-placed.png
3. Carry the bowl to the same destination table through the same native small-item path.
   - expect: actual support and saved parent change, hand contact is continuous and both items fit separate surface slots
   - screenshot: bowl-placed.png
4. Wave and speak after finishing; inspect all reach, grasp, travel and release pictures.
   - expect: ordinary faculties work, zero browser errors, meaningful nonzero held/native samples
5. Reopen the saved world after an owned-server restart.
   - expect: both real objects remain on their final surface; no held state or old-location light

Companion native checks cover interruption before grasp, free-hand wave, active restore and chunk rollover, with 100 distant unused lanterns contributing zero compact bytes or idle item tracks. Sparse rendering checks cover real GPU center/halo positions and bounded buffer-update ranges even when invisible. Preserve baseline/failed proofs. Do not claim a new custody system or broad old-definition migration: new opted-in revisions reuse existing take_item/put_item and surface slots.
