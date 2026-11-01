---
id: soul-frisbee-hand-continuity
tier: regression
fixture: soul-actions-frisbee
mocks: []
critical_path: true
---
# Frisbee entry, catch handoff and native release continuity

## Steps
1. Refuse a blocked pair, then walk the bystander aside and start a real pair.
   - expect: honest blocked receipts, and a clear pair depicts an actual flight
2. Walk the bystander into the active corridor.
   - expect: flight disappears at release onset while bystander remains more than 0.5 m from the lane; arms lower before both failed receipts settle
   - screenshot: clearance.png
3. Walk to the three triangle corners and play through each player's catch and next throw.
   - expect: all three throw and receive, one airborne disc maximum, no third body in the flight; native entry, turn handoffs and final release have palm movement below 0.25 m per 50 ms
   - screenshot: triangle.png
4. Finish, wave and speak.
   - expect: body and hands released, speech accepted, no browser errors

This focused regression follows actual observed 0.65–0.70m palm snaps in the completed functional clearance scenario. Preserve that evidence; final capture must include dense inspected hand frames as well as quantitative continuity. Choreography remains nonphysical.
