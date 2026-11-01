---
id: soul-movable-seating
tier: regression
fixture: soul-actions-seating
mocks: []
critical_path: true
---
# Relocate real seating and use it

Owned loopback7858 world, no product data. Same native upright handling as Day3. Parser and source proof scripts retained. No teleport or test-driven pose replacement.

## Steps
1. Carry chair to left-landing and sit on the real relocated seat; stand afterward.
   - expect: completed move and sit; real native grip/lift, correct sitting position, continuous reach/release, no stale old-seat position
   - screenshot: chair.png
2. Carry armchair to right-landing, sit, then stand.
   - expect: materially different seat uses same faculty; body on actual relocated seat; hand and hip steps below .25m per50ms through carry contact
   - screenshot: armchair.png
3. Return chair to Start beside the bowl, sit and stand through its front arc.
   - expect: clear front exit, no rear/backrest crossing; authored seat height; actual standing support
   - screenshot: front-exit.png
4. Wave.
   - expect: completed unrelated action; zero browser errors
   - screenshot: final.png
