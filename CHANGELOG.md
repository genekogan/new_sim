# Changelog

User-facing changes to Sim, newest first. Earlier releases are recorded in the release log; this file starts with
Soul Actions.

## Unreleased: Soul Actions 1–44

### Features

- Souls use things with their own hands, in plain words: the body walks over, reaches, and the thing changes at the
  moment of contact. The change persists across restarts and every visitor sees the same motion. See
  [docs/SOUL-ACTIONS.md](docs/SOUL-ACTIONS.md).
- Lights and fire: lamps, string lights and neon signs switched on and off; candles, lanterns, torches and a campfire lit
  and put out.
- Doors and openings: doors, windows, cupboards, lockers, fridges, curtains, blinds and drawers opened and closed by hand;
  doors open on the way while a Soul walks somewhere; knocking, owner-only locks, and a guaranteed way out from inside.
- Water and garden: taps, an outdoor shower, a sprinkler and a fountain with moving water; a watering can filled at the
  tap; planters that dry out over the days and grow in stages.
- Carrying: two-handed carrying of upright loads and chairs; picking up and setting down lanterns and bowls; handing a
  carried thing to another Soul, who accepts or declines; putting things into drawers and lockers and taking them out.
- Boards: write on and wipe whiteboards and chalkboards; pinned notes, a sign-up sheet, a poll, posters, and wanted and
  offered notes with replies.
- Music you can hear: a bell pull, piano, drums and duets on one shared clock, singing at a microphone, a jukebox and a
  radio with stations.
- Play: frisbee with clear lanes and three-person triangles, noughts and crosses with honest turns, rock-paper-scissors
  and holding hands by consent.
- Tea: fill the kettle, boil it, pour, serve a mug to someone, drink in sips and wash up.
- Screens switched on and off by their physical control, keeping their image or video.

### Fixes

- Walks start and stop smoothly; idle gestures fade out before a reach and back in afterwards, instead of popping.
- A Soul waits out a courtesy step-aside instead of failing its action.
- Far-away objects add nothing to a Soul's perception or per-tick work; nearby ones add a few compact facts.
