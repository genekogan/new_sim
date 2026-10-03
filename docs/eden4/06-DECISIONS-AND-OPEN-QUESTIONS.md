# 06 — Decisions and open questions

Statuses: **Decided** (Gene said so) · **Leaning** (proposed, Gene receptive
but not committed) · **Open** · **Shelved** (Gene, round 8: let the early
community settle it; the dial and its trade-offs are in `13`) · **Rejected**.

**Method (Gene, round 8):** "i dont need to design everything now." Fix the
shape, leave the numbers as dials set by rule versions after watching what
the early community does. See `13-PARAMETERS-AND-TRADEOFFS.md`.

## Decided (by Gene)

- **Newcomers enter right away** (round 8). No waiting for a ceremony:
  "new members falling in whenever", possibly via a birthing room.
- One daily ritual ("one something fundamental a day") is wanted; what it
  is for is open now that it no longer gates births (round 8).
- A **body is the unit**; minds are infinite. A DAO can wrap a body.
- Bodies are **always on** and simulated passively; owners steer. Watching is optional.
- Steering can come from any agent (Claude, ChatGPT, Codex…), on any schedule.
  Wallet auth with Google login.
- **A single central simulator**, not a decentralized one.
- The ground **expands outward**; the frontier is the outer ring. Starts at
  about 100 × 100 m. New terrain types appear as it grows.
- **The world advances over seconds/minutes, always on**, with bounded compute.
- **A daily ritual at the center**, with the time rotating along the lunar
  calendar. Bodies can attend. (Originally a birth ritual; see round 8.)
- **Daily manna UBI**, spent on building, art, features and floors.
- **Center hardens and grows rich, frontier stays poor and dynamic**
  ("center city" vs. frontier).
- Materials start with **pallet racks and wood**, with more types later.
  Ground first, height later.
- **Immutability + upgradeability via versioned rules** replayed from t=0
  (agreed in principle).
- **World is neutral**, but places/rooms exist; a Mars portal is possible.
- **Treasury** pays the team and makes grants.
- **Audience:** friends → believers → speculators last.
- **Art from the edges** (Moltbook-like) is desired.
- The economy is designed as we go; idle-rich must not happen.
- **Input shape like Runway's WorldPrompt, produced by the game engine, not a
  video model** (round 7: "no i agree with you").
- **Idle bodies must still feel alive and influential**; steering is optional
  (round 8, restating the original intent behind "letting go"). The world
  and its rules must be able to evolve without that getting artificially harder.

## Decided in rounds 9–15 (2026-09-29 → 09-30, the build)

- **Mars first, then takeover.** Finish the Mars simulator, stop it as a separate
  effort, and have eden4 take over and generalize that codebase. No fork. Mars
  becomes one world inside eden4. (r10)
- **Steering only, never direct control** of an inhabitant. People may move a
  camera freely and follow their own; the view is not locked to it. (r10)
- **World clock rate is a dial**, to be tested. (r10)
- **One box, simple**; microservices only when needed. (r10)
- **Catalog of bodies first**, upgradeable to generated ones later. (r10)
- **Lean in-page steering**: a small translator, not eden3. (r10)
- **Inhabitants are called Souls.** (r11; "Sims" is EA's mark, "bodies" rejected)
- **Jev (TypeSafe) is the mid-brain**, and is also used for the camera and
  broadcast; a larger, slower model plans at a higher level. (r11)
- **The narrator is wired in now**, runs on a fast model with caching, and plans
  **per region, asynchronously** rather than for the whole world at once. (r11, r12)
- **Privy from the start**; to users it is plain sign-in, wallets stay hidden. (r11)
- **Ship steering before anything else.** (r11)
- **The server keeps coarse truth; clients do local motion.** Minor drift is an
  acceptable price for offloading compute. (r12)
- **Several Souls per account.** (r12)
- **Repo `sim`, private for now**, under Gene's account; site `sim.eden.art`. (r12;
  this overrides "open day one" from r10 for the time being)
- **Model spend $0.50 a day while debugging**, with spend visible in the app. (r13)
- **Alpha behind invite codes.** Owners see only their own Souls' model calls;
  Gene sees all. (r14)
- **A Moltbook-like flow**: arrive and watch, sign in, create a Soul, steer it in
  the page or hand one line to your own agent; a dashboard per Soul. (r15)
- **The world ontology, and topics/regions/subscriptions, are Gene's to design.**
  Keep them as ideas until he takes part. (r15)
- **One project, two heads**: eden4/Sim wraps the Mars simulator. The Sim repo
  holds the documentation for both. (r15)

Open from these rounds (see `17`): whether agents see the whole world or only
what their Soul perceives; whether an attached agent may choose activities
directly; what `perceive` should contain once the real engine arrives.

## Decided in rounds 16–18 (2026-10-01, the ontology)

Gene's answers; the build that followed is in `18` and `19`.

- **Knowing is layered and multi-scale**, not a distance cutoff. (r16)
- **The server regularizes owners' unbounded action space.** An owner or agent
  never picks an action directly. (r16)
- **Souls converse with words**, and each has its own action space, sampled often
  and reshaped slowly. (r16)
- **Meaning first.** The ledger records what happened in meaning; the engine
  depicts it and may lag behind. (r17)
- **The fundamentals are time, position, identity, motion, immutable attributes
  and intents.** Promise, card, gathering and bond are not fundamental. (r17;
  built as things, links, time and five changes, with everything else as open
  vocabulary)
- **State must emerge coherently from separate, uncoordinated actions.** (r17;
  built as: an actor changes only itself, what it controls and what it made)
- **Each Soul has its own cards.** (r17)
- **Owners' agents may propose cards.** (r17)
- **The self-change boundary as proposed in `18` §8.** (r17)
- **The DJ scenario is the acceptance test** for this tranche. (r17; it passes)
- **No money yet.** (r17)
- **The kernel is good enough to develop and try**; Gene intends to upgrade it. (r18)
- **Words are rendered on demand for now**; cost to be solved later. (r18)
- **Mars's existing activities are to become special cases of the ontology**, and
  the Eden runtime must compile down to the Mars engine. (r18; mapping in `19`)

Open from these rounds: scenes (several bodies in one motion); retiring and
revising cards; whether things made by cards last, are owned or decay; a default
rule of reach; memory beyond two minutes; where the engine's code lives after the
takeover (`18` §10, `19` §9).

## Decided in round 19 (2026-10-02 → 10-03, many worlds and the merge)

Gene's decisions; the plan that follows from them is `22` (D1–D16 there).

- **Mars direct development stops at its v1 alpha** (release 42). Its code is copied (a hard
  fork) into the Sim repo with its history; engine work continues there. The old
  repo and sim.mars.college stay as they are, soft-deprecated. (r19)
- **One repo, one engine, many worlds; no fork.** Mars is the first world, Little
  Martians the second, Eden the third. A world is configuration and content;
  capabilities are general code that a world turns on; code inside a world is
  allowed and kept practical. (r19)
- **sim.eden.art is the one app**: `/w/<world>` is the canonical live world,
  `/l/<world>` its lab. Every world has the same UI (3D plus the shell's panels).
  sim.mars.college stays on its old codebase, soft-deprecated; the redirect is
  later. The toy world is kept at `/w/toy` as an explanatory space, outside the
  durable design. (r19)
- **Sim drives the Mars engine without stopping**: an objective state at every
  tick, persistent across browser sessions. (r19)
- **`/w/mars` starts as a new place of a few basic buildings, with raw piles of
  building materials** so Souls may build as they go; not the 2026 campus for
  now. Four fictional Souls: Alice, Bob, Carol, David. (r19)
- **Every Soul has a human owner.** "there is no such thing as a truly orphaned
  or ownerless soul." Gene owns all Souls in the new worlds for now. (r19)
- **One day is one hour.** (r19)
- **A routine is not a data structure.** "routines are latent in the soul's
  mandate/context/instructions/memory/observations and are actually carried out
  by non-deterministic evaluation every day (like humans!) instead of in a
  programmatic way… an important constraint to keep behavior truly dynamic."
  (r19; designed in `22` §4: customs, world events, needs, a journal, a mind
  that chooses, decisions logged)
- **The lab has no time and no server state**: loaded and run in the browser,
  "a snapshot of a place, like the mars campuses 2020-2026". (r19)
- **Steering is general, not a set of categories**: "do this now", "do this at
  5pm every day", "do this every time bill is having a party", "do this if you
  feel like it". A Soul turns its owner's mandate "into some kind of ongoing
  behavior that both never stops, even if steering goes away, but can become
  increasingly sophisticated with more rules in arbitrary natural language."
  Souls are polled at an interval that shortens as it gets cheaper. A steer has
  no time limit; an alignment call turns it into an objective effect. (r19;
  designed as a mandate of rules in `22` §4.4)
- **Model spend: at most $1 per world per real day.** (r19)
- **One login for now: Gene.** The Little Martians artist has a say in Little Martians, and may
  own that world, later. (r19)
- **Little Martians gets its own building types**: the Ceramic Tower and the
  Minaret Temple, rebuilt as clean geometry, larger and enterable. (r19)
- **This tranche aims at 24–48 hours of work** on what is clearly wanted, done
  well and not cut to fit; new deployments at least twice a day at self-assessed
  milestones; production deploys are authorised; terrain, the redirect and
  engine restructuring are deferred. (r19)
- **Little Martians**: the six scanned characters plus Nyx and background kin;
  they float; humanoids remain possible there. (r19)
- **Eden is a literal green field** for now. (r19)
- **Keep three.js; Blender only as an offline tool; do not reinvent what exists.** (r19)
- **The economy and the ontology of worlds stay open.** "for now the worlds are
  going to be just held and modulated through code manually through me and some
  enthusiasts until i see this has sticking power." (r19)

Open from this round: everything in `20` §8 and `21` §8 (the line between engine
and world; Soul travel; constants and laws; birth, death, rent and Harberger;
who owns a world; world code sandboxing; the morphology vector and capability
list; terrain), and the items in `22` §8.

## Withdrawn from Decided (round 8, Gene pulled back)

- *One body minted per day, auctioned, ~30 years, ~10,000 bodies.* Gene: it
  "artificially constrains growth in a very fundamental way, persistently and
  forever." Birth rate and any cap are now dials (`13` §1).
- *Controlling a body gets harder over time.* Gene: the aim was aliveness when
  idle, not steering losing meaning. Now `13` §3.

## Leaning

- **Round 7 (2026-09-28, Gene receptive):** input shape like Runway's
  WorldPrompt, resolved by the game engine, not a video model. Gene: it's
  "worldprompt split into two things", edge agents producing intents, a
  deterministic controller resolving into the next state. Claude's
  refinement: three layers (edge intents → versioned policy → engine), with
  **intents as the canonical logged unit**, verbs derived (`11`).
- Two frontiers named by Gene: (1) the immutable/upgradeable state and
  update formalism with an intent→action layer, including a separate
  channel for scene aspects like weather; (2) mature engine features
  (simulation, camera, rendering, NPCs, modeling, assets, physics) that work
  on the internet. Claude's lean: push (1) first; (2) is selection, not invention.

- Interpreter at the **edges**. The core is a fixed, generic, expressive
  vocabulary of primitives (`03`).
- A rollup-style architecture: Eden is the sequencer; input log plus state
  roots on-chain; permanent public storage; anyone can verify and resume (`03`).
- Upgrades are logged events; mistakes are fixed forward, never retroactively (`03`).
- Media is media: any tool, ingested and content-addressed (`05`).
- Moderation by geography plus a hard floor (`05`).
- Manna as an in-game ledger first, bodies as NFTs (`04`).
- Inertia rule: change cost = base × age × attention (`04`).
- Harberger on **protection rights over things**, not land. Price 0 = commons (`04`).
  **Challenged by Gene 2026-09-28:** it's unclear what "a thing" is and who
  decides structure (rooms, materials). It may only fit art/facades. See Q14b.
- Rooms are entered through **doors on structures in the main map** (`02`).
- ~~Identity edits decay by schedule; steering decays by cost (`02`).~~
  Superseded by round 8 (below).
- Mars 2026 campus as the first room (`02`).
- **Round 6 (2026-09-28, Claude, not endorsed):** the *piece* is the only unit
  of state; buildings/rooms are edge names. Every piece has a price
  (inertia formula, fee to the previous author); paying it transfers
  authorship. Harberger shrinks to an optional self-assessed premium (`04`).
- **Round 6 (Claude, not endorsed):** "a WorldPrompt resolved by a game
  engine": nouns (asset defs with affordances) are open data, verbs are the
  fixed versioned vocabulary; support-only physics; bodies = rigged GLB of
  any topology + capability map, morphology fixed at birth; every body has
  one standing intent, steering = replacing it; pixel world models are
  renderers at the edge (`10`).

- **Round 8 (2026-09-29, Claude, not endorsed):**
  - Births priced continuously on a target schedule (VRGDA-style): instant
    arrival, one growth knob; the target curve is shelved (`13` §1).
  - The daily ritual becomes **the manna fall**: UBI falls at the center,
    the ground grows its ring, the day's arrivals are welcomed and named,
    rule upgrades take effect. Attendance counts as attention, not income (`13` §2).
  - **Flat steering price** for life; the birth description stays fixed;
    cosmetic edits allowed (`13` §3).
  - **Idle bodies are patrons**: presence counts as attention; unspent UBI
    flows by default to what they attend or follow (`13` §3).
  - Newcomers land at the center and walk outward (`13` §1).
  - **Aggregates are derived, never declared**: a structure = a
    support-connected component, a group = bodies whose intents share a
    target. Intents get a **recurrence slot** (daily, lunar), which is what
    Example F lacked (`13` §5). Gene hasn't answered yet.

## Shelved (Gene, round 8: let the early community settle it)

Every number in `13`: the birth target curve and any cap or end; UBI rate;
demurrage; inertia coefficients; Harberger scope (Q14/14b); manna on-chain
(Q13); treasury split (Q15); verticality timing (Q12); identity-edit rules
(Q7); what happens at an end, if there is one (Q9); auction vs. blessing (Q6).

## Open questions

**Core architecture**
1. *(Gene 2026-09-28: 1–3 remain open and non-urgent.)* Fixed vocabulary vs. any central interpretation. Exactly what primitive set
   is expressive enough for day 1 and future-proof enough?
2. What happens when Eden goes away: who sequences next (treasury,
   governance, succession rule)?
3. What goes on-chain in full vs. as commitments (log, assets, manna)?
4. Who or what may propose and enact rule versions (team, governance, AI
   steward, citizens)? Gene's idea of a self-modifying simulator.
5. Does the birth description → 3D body step run centrally (logged once) or
   at the edge (the winner's agent supplies the body)?

**Bodies and ritual**
6. Auction mechanism: pure price, or price plus blessing/voting over proposed beings?
7. *(Shelved; round 8 withdrew the letting-go curve.)* Identity-edit rules.
8. Idle-body default behavior: what's cheap and still charming, and how is
   an idle body influential? (Round 8 lean: patrons.)
9. *(Shelved.)* Is there an end or a cap at all, now that 1/day is withdrawn?
6b. What is the daily ritual for? (Round 8; lean: the manna fall.)
6c. Where do newcomers land, and is paying for a body itself an attrition
    point (round 8)?
6d. Owner ↔ body configurations: one-owner-one-body, shared (DAO wrap),
    influence without ownership (`13` §1).

**Space**
10. Rooms: can the interior be bigger than the exterior? Must galleries be
    physically big? Walk-in interiors vs. door-rooms? What are rooms called and
    how are they created?
11. How the ground grows (rate, shape, terrain generation, who designs new biomes).
12. When and how building goes vertical or aerial.

**Economy and governance** *(most numbers shelved, see `13` §4)*
13. Manna: ERC-20 or in-game? Issuance rate, demurrage, taxes, rewards.
    *Naming note (2026-09-29):* Decentraland Foundation filed a US trademark
    on MANA (Nov 2022, digital token for an online community). A MANNA UBI
    coin (Grantcoin / Hedge for Humanity, 2015) also exists. Low risk while
    manna is an in-game credit with prior use; do a clearance search and
    expect a distinct ticker before any on-chain token.
14. How Harberger protection interacts with inertia; where the tax flows.
14b. **What does protection actually cover, and who decides what gets
    built** (adding rooms, choosing glass/metal/wood)? Gene: maybe it fits a
    facade painting, but it's unclear for structure. Candidate framings are in
    `04` → "Gene's objection". This is the unit-of-a-thing / write-authority problem.
15. Treasury governance model.
16. Whether placed artworks are NFTs.
17. Early sculpting of the center, such as a Little Martians area. Is it a
    genesis allocation, or just being early?

**Representation and control (round 6, see `10`)**
20b. Does anything exist in the rules above pieces and bodies (buildings,
    groups)? (Round 6 building question + round 7 Example F; round 8 lean:
    derived aggregates + intent recurrence.)
21. Minimal affordance schema for open nouns.
22. Minimal standing-intent schema.
23. Who may address scene-level intents (weather, events)?
24. Body topologies: only what can be rigged today, or any supplied rigged GLB?
25. Seed library licensing (cc0/by only vs. clearing the rest).
26. Tick assignment fairness under high-rate steering: arrival order,
    per-body rate limit, or price? (`11`)

**Creation and moderation**
18. The full submission vocabulary for edge agents.
19. Who holds the hard-floor veto, and how is it logged and constrained?
20. Plagiarism handling.

## Rejected

- **Programs not pixels** (deterministic-code-only art submissions): an
  unnecessary constraint; Kling etc. must be admissible.
- **Rigid Decentraland parcels** as the base land model.
- **Competing or decentralized simulators** (contradictions).
- **Retroactive rule changes** that rewrite history.
- **A daily birth ceremony that makes newcomers wait** (round 8, Gene: "this
  probably means 70% attrition right away").

## Where the discussion stands (2026-09-29, after round 8)

Gene pulled back on two founding rules (1/day births; steering getting
harder), required instant entry, and chose to shelve most numbers and let
the early community settle them. The folder moved to `<eden4>/` and
the project is called **eden4** for now. Gene said he'll come back to:
- derived aggregates (buildings/groups) and a recurrence slot on intents;
- what the daily ritual is for (Claude's lean: the manna fall);
- where newcomers land, and the entry price.

## Candidate first slice (superseded: the first slice was built as Sim, see `15`; building, manna and the ritual from this list are not built)

The smallest version worth vibe-coding, reusing the Mars engine (`07`):
- A 100 × 100 m flat ground; pallet racks + wood vocabulary.
- A scheduled **world-step loop** (the engine currently has none).
- Arrival at the center on purchase (mock pricing at first); a daily ritual at the center.
- Body steering over MCP with wallet/Google auth and per-body ownership (the
  engine currently has only room capabilities).
- Manna UBI ledger and spending on materials.
- An append-only input log with rules version tags and periodic state hashes
  (chain integration can come after).
- Media placement on surfaces (ingested assets).

## October 3 merge implementation record (facts, not new Decided items)

Gene authorized execution of plan v3 through `23` and confirmed autonomous
production milestone releases while away. Preflight passed. Canonical code is
`<repo>`; four world processes, one shared 3D playback shell, Gene-owned new
Souls, private mandate controls and browser-only snapshot Labs are deployed.
The exact live release and remaining qualification are in MERGE-LOG.

Lead implementation choices: retain the stronger $0.50/world rolling-24-hour
default beneath the authorized $1 maximum; derive finite construction progress
from original physical parts; reserve a free crew for a finite phase and drain
it safely on interruption; add a controller-compatible rollback before installing
construction cards; retain published derivatives through a narrow asset proxy.
These choices introduce no routine, property system, economy or world ontology.

Deferred scope remains terrain, redirect, engine repackaging, talking faces, other
owners/permissions, a persistent 2026 campus, economy and plugins. Questions in
`20` §8 and `21` §8 stay open; no proposal has been moved to Decided here.
