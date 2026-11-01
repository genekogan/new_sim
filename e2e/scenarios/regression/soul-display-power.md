---
id: soul-display-power
tier: regression
fixture: owned-display-power
mocks: [fake-brain, dev-auth]
---
# Physical screen power

1. Open owned loopback7864 full client at the front of the displays.
   - expect: image visible, initially off video frame dark, no video request
   - screenshot: initial
2. Ordinary paired Soul switches image screen off then on, and video frame on then off.
   - expect: receipts completed; state/face changes only at depicted hand contact
   - expect: arm stays near authored control at full contact; entry and full recovery continuous; feet remain on ground
   - expect: video visibly plays while on and pauses while off; media/title/maker retained
   - screenshot: four complete operation phases
3. Wave and speak after display actions, then stop owned process and restart the same persisted world.
   - expect: ordinary faculties remain usable; screen on, video frame off, content unchanged
   - expect-console: no errors
