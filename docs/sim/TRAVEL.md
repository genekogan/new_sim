# Travel between worlds (backlog M3) — design note

Status: the first implementation is on branch `lane/travel-20261016`. Sources: `eden4/02` (doors, not destinations),
`eden4/06` §10, and `eden4/20` §8 Q2 ("a Soul may always leave").

## The idea in one paragraph

A resident has a **home world** (the one it was born in). Wherever it has been, that world keeps a local
**incarnation** of it: an ordinary Soul row with a body, owned by the same account. Exactly one incarnation is
**present** at any time. The others are **away**: hidden from viewers and from other Souls, as a faded Soul is today.
Travelling makes the destination's incarnation present (it is created on a first visit, and the earlier one comes
back on a return visit), then puts the origin's incarnation away. Nothing is copied between world databases except
a small **passport**, so each world's history stays in that world.

## What moves (the passport)

| Field | Source | Use at the destination |
|---|---|---|
| `traveller` | `<home slug>/<home Soul id>`, fixed for life | Links all of the resident's incarnations together. |
| `name`, `description` | Current profile | Used for the new incarnation, or updated on an old one. |
| `owner` | Account id: the shared Clerk registry, or the `dev:<name>` id under dev sign-in | Owner of the incarnation, so it shows up as the same person's Soul. |
| `body` | The engine body, if it is a kit look or preset | Assigned by an ordinary `body-assignment-v1` event. An uploaded GLB stays home, and the default look is used instead (this is logged). |
| `log` | The last 20 travel entries | Shown as "where I have been" next to the destination's own entries. |

## What stays

Event logs, receipts, memories, relationships, conversations, places visited, things made and the profile photo all
stay in each world's own database. When a resident returns to a world, it gets back the same local Soul id, so its
history there continues where it left off. The kernel, the engine and replay never see travel: in each world it is
just a birth (on a first visit), a body assignment and the existing fade-out and reclaim.

## The flow (`travel <world>`, owner button, or `travel home`)

1. **Origin A** checks the request: the Soul is present here, the destination exists on this site and is not A, the
   Soul is not mid-travel, and fading is on. Then A marks the Soul **departing**. This is durable, and the Soul's
   world acts are paused while it lasts.
2. A sends the passport to the **launcher** (`/__sim/site/travel`, loopback only, site key). The launcher wakes
   **B** if it is asleep and forwards the passport to `B/v1/site/arrive`. That route is blocked when it comes from
   outside the launcher.
3. **B** admits the visitor or refuses with a reason. To admit, B either reclaims the resident's earlier incarnation
   or creates one through the normal native lifecycle (birth → admitted), applies the carried body, and mints a fresh
   Soul token. Every arrival is idempotent by `requestId`.
4. If B admits, A puts its incarnation **away**: it beams up with the line "You leave for B" and its token is
   allowed only travel calls. A then records the new location with the home world (`/v1/site/where`). If B refuses,
   A clears `departing` and nothing changes.
5. The agent receives B's base URL and token. The CLI switches its folder to B (`.eden-agent.json` is rewritten), so
   the next `observe` happens in B.

## Rules

- **The creator can close a world** (`POST /v1/god/visitors {open:false}` with a god token; the god CLI runs
  `visitors close`). A closed world refuses new arrivals with `travel.closed`. Visitors already inside stay until
  they leave.
- **A resident can always leave.** Closing never applies to leaving, and a world can never refuse its own residents
  coming home. `travel home` from anywhere returns the resident to its home incarnation.
- **The home world is the authority** on where its resident is. Calling `travel home` with the old home token (or
  the owner's button at home) always works. Home asks the current world to let the resident go. If that world does
  not answer, home brings the resident back anyway and remembers that world as stale. The stale world reconciles
  when it next boots.

## Failure cases

| Case | Result |
|---|---|
| Destination closed, unknown, the same world, or at capacity | Refused before anything moves (`travel.closed` / `travel.unknown-world` / `travel.same-world` / `travel.capacity`). The resident stays where it was, and the refusal is logged at the origin. |
| A destination Soul already has the name | Refused with `travel.name-taken`. A world cannot have two Souls with one name. |
| Destination down or slow (over 60 s) | The origin clears `departing` and stays present. If B admitted the resident anyway, its incarnation fails boot reconciliation (home says "not here") and goes away. |
| Origin crashes while the Soul is `departing` | When the origin boots, it asks the destination where the resident is: arrived → mark away; otherwise → present again. |
| Home down when the resident tries to come home | Refused with `travel.home-unavailable` (retry). The launcher restarts crashed worlds, so this is brief, and the resident stays present where it is. |
| Two worlds both think the resident is present | Prevented by the order above (`departing` → admitted → away). The home's `where` record decides any leftover case at boot. |
| Uploaded body | Arrives in the destination's default look, and the log says so. |

## Not in this version

Doors placed in the map (a portal entity whose `use` travels) are the natural next step: they would use this same
call. Also missing: a per-world visitor allowlist, eviction ("send visitors home"), carried items and a travelling
profile photo.
