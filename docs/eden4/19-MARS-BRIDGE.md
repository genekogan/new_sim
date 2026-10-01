# 19 — The Mars bridge: how the Eden runtime compiles down to the Mars engine

> Status (2026-10-01): **proven on the proving ground, planned for the campus.**
> Written the day before the Mars engine is taken over. Everything under
> "Proven" was run today against the Mars checkout at commit `9638489`
> (release 27), imported read-only; nothing in the Mars repository was changed.
> The code is `packages/engine-mars` in the Sim repo. Everything under "Plan"
> is a proposal for Gene.

## The short version

The whole Sim shell (event log, kernel, cards, minds, speech, client sync,
agent interface) now runs with the **real Mars engine** moving the bodies. Start
the server with `ENGINE=mars` and six Souls are born on the Mars proving ground,
walk Mars's routed paths, sit on Mars's benches, take places at Mars's campfire
and stand in Mars's conversation circles. The DJ story passes there: Rob hosts
at the fire, Wren walks over and asks, Rob says yes, Wren becomes the DJ.

Nothing in the kernel or the cards knows which engine is underneath. That is
the claim of doc 18 ("meaning replays without the engine"), now tested with two
different engines.

| Test on the Mars engine | Result |
|---|---|
| Engine conformance (determinism, seeds diverge, mid-action restore, hashes, verbs, clean failure) | 6 of 6 |
| A program of body steps runs in order, with progress events and no physical violations | pass |
| An impossible first step is refused without disturbing the actor | pass |
| A conversation borrows a free body; that body's own program takes it back | pass |
| A world restored from a snapshot mid-program carries on identically | pass |
| Replay of the event log from genesis reproduces the live world; the kernel replays with no engine at all | pass |
| Restart from a snapshot plus later events equals the uninterrupted world | pass |
| Two clients fed keyframes agree with the server's view hash | pass |
| The DJ story through the real server, with Mars bodies | pass |
| The DJ story from two plain-language wishes, **live models**, Mars bodies (compiler mints the cards; Rob agrees by reflex) | pass, $0.04 |
| A world's own verbs (`mars:take_slot`, `mars:face`…) used directly as steps | pass |
| **One of Mars's own authored scenarios** (four people take bowls and spoons, serve themselves stew, sit round the fire and eat) run unchanged as four programs | pass |
| 20 people strolling | 0.36 ms per tick (budget: 50 ms) |

## 1. Three levels, two translations

```
   MEANING            a Soul plays a card on a target            kernel: things, links, five changes
      │                 (ask to be the dj → Rob's gathering)      engine-independent, replays alone
      │  the card's depiction: a short list of body steps
      ▼
   BODY LANGUAGE      walk_to · sit · stand · rest · wave ·       what ONE actor's body does
      │               converse · gather · perform · wander        nine verbs, the same for every engine
      │  the adapter lowers each step when it begins
      ▼
   ENGINE VERBS       Mars: walk_to{x,z} · face · sit · take_slot ·     routes, slots, reservations,
                      converse{actors} · gather · campfire_circle …     pre-emption, collisions
```

The **body language** is the stable middle. Cards are written against it, so a
card minted in one world works in another. An engine adapter is the only code
that knows engine verbs. A world can also expose its own verbs for vocabulary
that belongs to it: on Mars they appear as `mars:serve`, `mars:eat`,
`mars:carry` and so on (52 of them), and a Mars card may use them in its
depiction.

How each body step lowers on Mars today:

| Body step | Mars actions | Notes |
|---|---|---|
| `walk_to {to, standoff}` | `walk_to {x, z}` then `face` | The adapter picks a reachable standing point near the target, trying eight directions. |
| `sit {on}` | `sit {fixture}` | Mars includes the approach, the turn and the sit-down. The seat is kept after the step ends. |
| `gather {at}` | `campfire_circle`, or `gather {fixture}`, or `gather {region}` | Whichever the target supports; if there is no place to take, stand near it. |
| `converse {with}` | `converse {actors: [me, them]}` | Only if the other body is free. Otherwise `face` them and wait. |
| `wave {at}` | `face` then wait | No waving in Mars yet. |
| `rest`, `perform` | wait | No such motion in Mars yet. |
| `ambient_wander` | several `walk_to` and pauses | Mars's own `ambient_wander` cannot be resumed from a snapshot, so the adapter builds strolling from walks. |
| `stand` | `stand` | |

## 2. Three rules the adapter adds

The Mars runtime was built to rehearse and record bounded scenes that a caller
choreographs. A world that never stops, with many independent minds, needs
three things the caller used to guarantee by hand.

1. **One actor, one program.** A Soul's decision replaces whatever its body was
   doing. The adapter keeps one program per actor, runs its steps in order,
   reports each step and the ending, and releases any seat or circle before a
   step that needs the body free.
2. **Joint staging is borrowed.** Many Mars verbs take several actors in one
   action (`converse {actors}`, `carry {crew}`, the classroom). In the kernel an
   actor changes only itself. The bridge between the two: a depiction may
   borrow another body while that body is free, the other Soul's own program
   takes its body back at any time, and the borrower treats that as the scene
   ending, never as a failure. Mars's pre-emption (a directed action releases a
   social hold) is exactly the mechanism this needs.
3. **Ask before acting.** In Mars a refused instruction still pulls a person out
   of what they were doing. The adapter asks `verb.plan()` first (it has no side
   effects) and only then submits. The same call answers the card system's
   question "is this physically possible right now?".

## 3. How Mars concepts map to the kernel

| Kernel | Mars engine | State of the mapping |
|---|---|---|
| Soul (a Thing) | a `human` entity; `traits.body` holds the entity id | done |
| Place (a Thing) | a region (polygon) or a fixture entity; `traits.point` or `traits.entity` | done through `anchors()` |
| Region | Mars regions are sparse islands, so the adapter adds one region for "everywhere else" | done; real maps need districts |
| `at` | derived from where the play happened (kernel), never read back from poses | done |
| Card `when` | kernel conditions, plus `verb.plan()` for the first body step | done |
| Card `then` (the five changes) | nothing: Mars has no notion of roles, agreements or ownership | by design: meaning lives in the kernel |
| Card depiction | a program of body steps | done |
| A play takes effect | when the approach steps have finished (`step` progress events) | done |
| Gathering (a Thing with `hosts`, `attends`) | separate holds per person at the same fixture | works; a **scene** would stage it better (section 5) |
| `say` | a conversation circle if the listener is free, else facing them; the words are rendered separately | done |
| Manner (warmly, shyly…) | nothing yet | an animation todo |
| Control links (`hosts`, `holds`, `made`) | nearest thing is `reservedBy`, which is per action and not social | kernel only |
| Things made by cards (a DJ kit) | no entity is created | needs "appear" to place a catalog item (section 6) |
| `wants` on a card | nothing | this is the list of motions to build next, ranked by how often cards ask |

## 4. Mars's activities as special cases

Gene: the Mars world "has a specific set of activities which are supposed to
become special cases of your ontology." Mars has five hand-built activity
coordinators. Each is a small state machine that owns several people. Here is
what each becomes.

| Mars coordinator | What it hard-codes | In the kernel |
|---|---|---|
| `classroom_session` with `classroom_control {join, depart, question, advance, cancel}` | host, presenters, audience, seats, a queue of questions, presenter rotation, a talk afterwards | A Thing of kind `class`. Links: `hosts`, `presents at`, `attends`, `wants to ask`. Cards: *start a class*, *take a seat*, *present*, *raise a hand*, *call on*, *leave*. Each control intent is one Soul's own play. The phases are no longer a script; they are whatever the plays add up to. |
| `shared_food_break` | two named people fetch utensils, serve, eat, return | A `meal` gathering. Cards: *serve yourself* (`mars:take_item`, `mars:serve`), *eat with* (`sit`, `mars:eat`). Any number of people. |
| `purposeful_routine` with its control verb | join a session, then a meal, then rest, then finish notes; pause and resume | An **agenda**. This is the one Mars coordinator the shell already replaces entirely: an ordered plan a mind follows, re-thinks and resumes. |
| `gathering_continuation` | "after this gathering, do that" | An agenda step that follows a `leave`, or a step with `of` bound to the gathering. |
| `setup_room` | move one chair and one table to an authored layout | A card *set up the room* (`mars:move_fixture`), allowed to whoever controls the room. |

Construction (`carry {crew}`, `raise_upright`, `connect_beam`, `hand_up`…) is
the harder family: one Mars action needs two to four bodies working as one. The
kernel form is a **crew**: a Thing that Souls join by their own play (*join the
crew*), with a card (*carry the beam*) that becomes playable when the crew has
the people the Mars verb needs. That is the same shape as asking a host and
being answered: joint outcomes emerge from single-actor plays.

So the claim holds in both directions. Every Mars activity can be written as
vocabulary (a kind of Thing, a few links, a few cards). And the Mars
coordinators remain useful as **staging**: a well-choreographed way to depict a
class or a meal once the kernel says one is happening.

## 5. The missing layer: scenes

Today each Soul's depiction is its own program. That is enough for hosting,
joining, asking and talking. It is not enough for a class with seating and a
question queue, or for four people carrying a beam.

**Proposal.** A *scene* binds one kernel Thing (a gathering, a class, a crew) to
one Mars coordinator action:

- When the Thing appears and enough members have joined, the adapter starts the
  coordinator (`classroom_session`, `carry`).
- When a Soul plays *join* or *leave*, the adapter sends the matching control
  intent (`classroom_control {join}`), or re-stages.
- When the Thing vanishes, the coordinator is cancelled.
- A member's own program always wins: Mars releases that member
  (`canYieldMembers`, `releaseMembers`) and the scene goes on without them.
- After a restart, scenes are **re-staged from the kernel**. Most Mars
  coordinators cannot be resumed from a snapshot, and they do not need to be:
  the kernel knows who is in the class, so people are simply seated again.

This is the answer to "the eden world runtime needs to reduce or compile down to
that": cards compile to body steps for one actor, and kernel Things compile to
scenes for many. Scenes are not built. The only instance so far is the smallest
one: a conversation borrowing a free body.

## 6. What the takeover has to change in the engine

Found by building the adapter, in rough order of importance.

1. **A way to add and remove people while running.** There is none; the adapter
   edits `world.entities` and restores canonical order, which is what the Mars
   world editor does offline. It needs to be a logged, checked operation.
2. **Retention.** `Runtime.records` and `Runtime.events` grow for ever. Fine for
   a five-minute take; a world of 25 Souls adds roughly 70,000 records a day. The
   adapter prunes them from outside.
3. **Resumability.** Only eight verbs resume from a snapshot exactly (`walk_to`,
   `take_slot`, `sit`, `stand`, `face`, `converse`, `gather`, `campfire_circle`).
   The body language uses only those. `eat`, `serve`, `carry`, every
   coordinator and Mars's own `ambient_wander` do not. Either they become
   resumable, or (preferred, see section 5) the world accepts re-staging from
   the kernel after a restart.
4. **Solo expression.** There is no way for one person to wave, talk without a
   circle, sing or dance. The `wants` lists on cards will rank these by demand.
5. **Movement cannot be predicted from a decision.** Mars walkers yield, queue
   and re-plan, so a client cannot extrapolate a path the way it does with the
   toy engine. The adapter broadcasts a keyframe per moving body four times a
   second (the same `PoseSample` format Mars's take recorder uses) and clients
   draw a quarter of a second behind. The keyframe interval must divide the
   heartbeat interval, so the view hash still compares like with like.
6. **Things that cards create.** A card can make a Thing (a DJ kit). Nothing
   appears in the engine. Needs: "appear" may name a catalog item, and the
   adapter places it at a free spot.
7. **The campus is unfurnished.** The real 2026 campus loads in 3 ms as walls,
   decks and nine regions, with six people and **no fixtures at all**. Benches,
   chairs, tables and fires exist only inside scenario files. A Mars world for
   Eden needs a furnishing file: which fixtures stand where.
8. **Levels.** The proving ground is flat. Decks, stairs and rack beams
   (`level`, `climb_frame`, `beam_walk`) are untested through the adapter.

## 7. Running Martian simulations after the fork

Gene: "still be able to run martian sims this way in the mars world." Because
the adapter wraps the engine and changes nothing inside it, both ways of running
stay available on the same code.

| | Mars studio today | Mars as a world in Eden |
|---|---|---|
| World | a campus year file, forked into a workspace | the same file plus a furnishing file, as one world's genesis |
| Who decides | a caller submits verbs or a sequence template | Souls' minds choose cards; owners set agendas |
| Scripted scenes | `mars-sequence/1` templates, rehearse then execute | a **cast with fixed agendas and no model**: a Soul whose mind is its script. Or a program whose steps are raw `mars:` verbs, for exact choreography. |
| Activities | five coordinators | a Mars vocabulary pack (cards for class, meal, building a bay, riding), staged by those coordinators as scenes |
| Output | a take (pose tracks, events) | the same keyframes, recorded; a take is a slice of the world's stream |
| Time | bounded, as fast as it computes | continuous at 20 ticks a second, or a private instance run fast |

A "Martian sim" in the new terms is: start an instance of the Mars world with a
cast and their agendas, run it for a while, keep the recording. The meal
scenario already runs this way: its authored steps, addressed as `mars:` verbs,
become one program per person, and the adapter's program runner replaces the
scenario's hand-written step driver. The history
years, the museum, the evidence and provenance rules and the cinematography stay
Mars's own and are untouched by any of this.

## 8. Proposed first days

1. **Day 1.** Decide where the engine lives (recommendation below). Run staging
   with `ENGINE=mars` on the proving ground so Gene can watch real bodies in the
   existing pages. Fix what the first hour of watching shows.
2. **Day 2.** A furnished world: the 2026 campus with a first set of fixtures,
   its regions as kernel places, an arrival point. Souls living on the campus.
3. **Day 3.** The first scene: a gathering staged by one Mars coordinator, with
   join and leave as control intents. Then a Mars vocabulary pack: *cook dinner*,
   *give a talk*, *build a rack bay* as cards.
4. **After.** Engine changes from section 6, in order, each behind the
   conformance suite.

**Where the engine lives.** Three options: keep importing by path (works today,
but two repositories drift), copy the engine into the Sim repo as
`packages/engine` (one repository, one history from the day of the fork), or
make Sim a consumer of a separate engine package. Recommendation: copy it in at
the moment Mars development stops, keep `packages/engine-mars` as the only code
that touches it, and keep the conformance suite as the wall between them. The
Mars repository is local-only and has never been pushed, so this is also the
moment its engine first reaches GitHub; that is Gene's call.

## 9. Questions for Gene

1. **Scenes** (section 5): is "a kernel Thing staged by one coordinator, and
   re-staged from the kernel after a restart" the right way to keep Mars's
   choreography without making it the truth?
2. **Body language**: is a fixed, small, engine-independent set of body verbs
   the right middle layer, with raw engine verbs allowed only in vocabulary
   that belongs to one world?
3. **Furnishing**: should fixtures be placed by a file someone authors, or by
   Souls through cards (the eden4 idea of building), with the file only as a
   starting state?
4. **The engine's home**: copy into the Sim repo at the fork, or keep separate?
