# 13 — Parameters and trade-offs

Round 8, 2026-09-29. Gene: *"i want to shelf some of the final decisions on
some of these and possibly just let them happen organically depending on
what early community likes. i dont need to design everything now."*

This file is the working method that follows from that. Fix the **shape**
of the world (what kinds of things exist and how they change). Leave the
**numbers** as dials that get set by rule versions, informed by what the
early community actually does. Versioned rules (`03`) make every dial
change a legitimate, logged event rather than a retroactive fix, so
shelving a decision costs little.

Each dial below has: what it controls, what each end of its range gives,
Claude's current lean (not decided), and a status:

- **Shelved** — Gene has chosen to let this settle with the early community.
- **Open** — still needs a design answer, not just a number.
- **Shape leaning** — the form is proposed; only the number is shelved.

## Philosophy: shape now, numbers later

- **Few kinds of things, many dials.** A new mechanism is expensive
  forever; a new value for an existing dial is one rules event.
- **Start loose, tighten on evidence.** It's easier to add friction when
  something is abused than to remove friction nobody enjoys. Where a dial
  has a "generous" and a "strict" end, v1 sits near generous.
- **Never make the future artificially harder.** (Gene, round 8.) The
  world and its rules must stay easy to evolve. Friction belongs to places
  and prices, not to the ability to change the rules.
- **Watch, then set.** Early days are measurement: who steers, how often,
  what gets built, where bodies go. Dials are set from that record, and
  the log makes the record exact.

## 1. Arrival (how bodies enter)

**Gene, round 8:** newcomers must be able to enter right away. Waiting for a
daily ceremony means losing most of them. "There could be a birthing room
but it's not tied to a time, it's just new members falling in whenever."

| Dial | One end | Other end | Lean |
|---|---|---|---|
| **Birth rate** | Fixed, 1/day (Nouns). Scarcity, a clean 30-year arc, the growth rate *is* the scaling roadmap. Caps the world at ~365/yr forever. | Unlimited, flat price. Fast growth, no scarcity, spam risk, compute arrives before design does. | A **price curve over a target schedule** (VRGDA-style): each body's price rises when births run ahead of the target and falls when behind. Continuous, instant, one knob. The target curve itself is **shelved**. |
| **Target curve** | Linear (N/day). | Exponential or logistic. | Shelved. Start near linear, loosen if demand is real. |
| **Cap / end** | Hard cap (~10k) and an ending that echoes Abraham's release. | Open-ended. | Shelved. The cap was a consequence of 1/day, not a goal of its own. |
| **Arrival place** | Center: first view is the famous city and the ritual ground. | Frontier: fits "poor frontier", room to build at once, worse first five minutes. | Center, then walk outward. Open. |
| **Entry price floor** | Real money for every body (checkout friction). | Free or near-free when births are behind target. | Open. The next attrition point after waiting. A free spectator mode would be a new mechanism, so not proposed yet. |

Rejected in round 8: a daily batch ceremony that settles births at the
ritual (Claude's first proposal) because it makes newcomers wait.

**Owner ↔ body configurations** (Gene asked to go through them):

| Configuration | Gives | Costs |
|---|---|---|
| **One owner, one body** (current) | Your own body; your agent attaches to it. The hook. | Supply is gated by births. |
| **Many owners share a body** (a DAO wraps it) | Collective play, clubs, cults. Already decided as possible. | None new. It's opt-in. |
| **Influence without ownership** (many people nudge unowned bodies) | Anyone can play without buying; spirits and fauna become communal. | No "mine"; no agent attachment; needs a way to weigh many voices. |
| **Owner decoupled from body entirely** | Radical flexibility. | Loses the core hook. |

Lean: keep one-owner-one-body as the base. Shared control stays opt-in (DAO
wrap). Influence-without-ownership, if wanted, lives on unowned creatures
through scene intents rather than on citizens. Open.

## 2. The daily ritual (what it is for)

Gene wants "one something fundamental a day" to build a ritual around, but
it can no longer gate births.

| Option | Gives | Costs |
|---|---|---|
| **The manna fall** (Claude's lean): at the lunar-rotating time, the day's UBI falls at the center; the ground grows its daily ring; everyone who arrived since the last fall is welcomed and named aloud; rule upgrades take effect. | Bundles things that already happen daily onto one clock. Biblical rhyme with manna. The world's biggest daily crowd. | Needs nothing new; the risk is it feels administrative unless staged well. |
| **A daily chosen one**: one arrival per day is elevated (auctioned or blessed) and gets the center moment. | Keeps a Nouns-style prestige object and Abraham's blessing. | A class distinction and a second mechanism. |
| **One new thing a day**: a material, a verb, a biome. | Ties the ritual to the world's evolution. | Pressure to invent daily; verbs should stay rare. |

**Attendance:** attending should count as *attention* (feeds inertia),
not as income. Making manna physically collectable only at the center
would give a free center-rich gradient but breaks UBI and punishes idle
bodies. Lean: don't.

**Ritual time:** rotates with the lunar calendar (decided for the birth ritual; presumably carries over to whatever the ritual becomes).

## 3. Steering and idle life

**Gene, round 8:** "letting go" was meant to solve *idle owners' bodies
still feeling alive and influential*, not to make steering lose meaning.
He sees a trade-off, and he wants the world to evolve without it becoming
artificially harder.

| Dial | One end | Other end | Lean |
|---|---|---|---|
| **Steering price vs. age** | Rises with age (old "letting go"): bodies drift toward autonomy, the world "becomes itself". Punishes engaged owners. | Flat forever: steering always matters. | **Flat.** Aliveness comes from the standing intent, not from making steering expensive. Rate limits for fairness only (Q26). |
| **Identity edits** (name, description, appearance) | Never (one-shot birth description is the whole identity). | Any time. | Birth description fixed; cosmetic edits allowed. The doubling/Fibonacci schedule is dropped unless the community wants it. Shelved. |
| **Intent expressiveness** (Q22) | One goal (simple; steering stays meaningful). | A routine of timed clauses (expresses a life; one message can run a body for a year). | Small fixed routine: a few timed clauses plus a fallback. Open. Note this is also what makes an idle body feel alive. |
| **Idle influence** | Idle bodies are scenery. | Idle bodies are the audience and the patrons: presence counts as attention, and unspent UBI flows by default to what they attend or follow. | Patrons. Solves idle-rich (decided must not happen) with the default spend already listed in `04`. |

## 4. Economy

| Dial | Range | Lean |
|---|---|---|
| **UBI rate** | Low (scarcity, building feels earned) ↔ high (abundance, fast frontier churn) | Shelved. Tie to the materials price list, not a number chosen now. |
| **Demurrage** | None (savers win, idle-rich) ↔ steep (use it or lose it) | Mild, or replaced entirely by the idle default spend. Shelved. |
| **Inertia** (`base × age × attention`) | Flat (everything stays editable; no famous center) ↔ steep (the center freezes early) | Keep the shape (decided that the center hardens). Coefficients shelved. Keep inertia per piece so things glued to a famous structure don't borrow its fame. |
| **Harberger premium** | Off ↔ required for protection | Optional premium on pieces only. Q14b still open; shelved until people are actually building. |
| **Manna on-chain** | In-game ledger ↔ ERC-20 | In-game first (`04`). Shelved; a bridge can come later. |
| **Treasury split** | — | Shelved until there is revenue. |

## 5. Space

| Dial | Range | Lean |
|---|---|---|
| **Ground growth** | Fixed ring per day ↔ keeps pace with population density | Density-driven. Works with any birth curve. Shelved number. |
| **Starting size** | ~100 × 100 m (decided). | — |
| **Verticality** | Ground only ↔ free building up | Ground first (decided); when height opens is a rules event. Shelved. |
| **Interior size** (TARDIS rooms) | Exterior = interior ↔ unlimited | Open (Q10). |
| **Aggregates** (buildings, groups) | Declared objects in state ↔ edge names only | Derived, not declared: a structure = a support-connected component; a group = bodies whose intents share a target. Open (Claude, round 8a; Gene hasn't answered). |
| **Intent time** | Timeless intents ↔ recurring (daily, lunar) | A recurrence slot on the intent, shared with the ritual's own schedule. Open. |

## 6. Simulation and engine

| Dial | Range | Lean |
|---|---|---|
| **Tick rate of the always-on world** | Seconds ↔ minutes (decided range) | A rule, not a promise; slow under load (EVE-style time dilation). |
| **Steering rate limit** | Arrival order ↔ per-body limit ↔ price (Q26) | Per-body limit. Open. |
| **Nouns intake** | Curated ↔ anyone can ingest | Anyone, validated affordances + hard floor (`05`). |
| **Verb additions** | Frequent ↔ rare and ceremonial | Rare. A candidate for "the day X was invented" at the manna fall. |

## Which to decide now vs. later

Decide early because they change the *shape*: arrival pricing form (§1),
what the daily ritual is (§2), flat steering (§3), idle influence (§3),
derived aggregates and intent time (§5).

Let the early community settle: every number in the tables, the cap, the
treasury split, demurrage, Harberger's scope, verticality timing.
