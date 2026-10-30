---
id: soul-seating-setdown-sync
tier: regression
fixture: soul-actions-seating
mocks: []
critical_path: true
---
# Exact native handoff during furniture setdown

New focused regression found by postprocessing the passing main journey: the armchair mesh eased last6.9cm after native grip release. Keep the pose override through carryContactV1 release. New source; no reassurance rerun. Native/controller/clear-front-exit evidence retained separately.

## Steps
1. Carry chair to left-landing, sit, then stand.
   - expect: complete ordinary receipts; native/mesh position error below1cm throughout reach, lift, travel, setdown and release; continuous hand/hip bounds
   - screenshot: chair.png
2. Carry armchair to right-landing, sit, then stand.
   - expect: same native/mesh synchronization through final release; no snap or stale override
   - screenshot: armchair.png
3. Wave.
   - expect: completed unrelated action, zero browser errors
