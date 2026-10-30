---
id: soul-door-natural
tier: regression
fixture: soul-actions-contact
mocks: []
critical_path: true
---
# Open, release and actually pass through an enclosed doorway

## Steps
1. Approach and pull the closed courtyard door through ordinary Soul CLI.
   - expect: torso stays facing doorway within30degrees after grasp, continuous handle contact, gradual release, no body/panel or jamb clipping
   - screenshot: pull.png
2. Walk to the courtyard bench with all enclosing walls retained.
   - expect: body crosses the actual doorway plane inside the opening width, rather than beside the frame
   - screenshot: inside.png
3. Close from inside, then push open and walk outside.
   - expect: forward pushing with torso facing doorway, complete release, actual reverse doorway crossing and no clipping
   - screenshot: push.png
4. Wave after finishing.
   - expect: ordinary unrelated gesture completes, no browser errors

Inspect dense pictures of approach, contact, swing, release and both crossings yourself. Native geometry supplements visual judgement. No wall removal, teleport or renderer-owned body motion. Existing no-policy recorded motions retain their prior semantics.
