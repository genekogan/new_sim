---
id: soul-frisbee-clearance
tier: regression
fixture: soul-actions-frisbee
mocks: []
critical_path: true
---
# Safe pairs and a three-Soul frisbee triangle

## Steps
1. Walk Alice/Bob to opposite ends and Carol to the middle through ordinary paired CLI.
   - expect: a blocked attempted game fails honestly for both, with no depicted flight through Carol
   - screenshot: blocked.png
2. Carol walks aside; start a clear pair, then Carol walks into the lane.
   - expect: actual visible throws with clear lane; both native games stop before Carol enters the physical flight; no continuing flight or stale game fields
   - screenshot: clearance.png
3. Walk three Souls to the real triangle corners and start ordinary play requests.
   - expect: all three participate; at least one depicted throw/catch by each; at most one visible airborne disc, correct receiver-facing and no third body in flight path
   - screenshot: triangle.png
4. Stop and wave; speak in the world.
   - expect: bodies free, unrelated wave and speech accepted; no browser errors

Native scoped tests cover walls/low props, different floors, near misses, active walking entry, checkpoint restore and unchanged legacy no-policy behavior. This remains recorded choreography, not a ball physics engine. A separate ordinary controller journey checks discovery/joining.
