# Glossary

Terms as used in this repository. Where the strategy notes use an older word, it
is listed.

| Term | Meaning |
|---|---|
| **eden4** | The project: Eden as one persistent, shared, simulated world. Working name |
| **Sim** | This repository and the running app shell (sim.eden.art) |
| **Mars engine / Mars Studio / Mars world simulator** | The deterministic engine built as a simulation of Mars College, in a local-only repo on Gene's laptop. Sim runs on it through an adapter (`packages/engine-mars`, `ENGINE=mars`) wherever a checkout exists |
| **Toy engine** | `packages/engine-toy`, the default engine: a small stand-in behind the same contract |
| **Engine contract** | `packages/engine-contract`: what the shell needs from any engine. See `sim/ENGINE-CONTRACT.md` |
| **Soul** | An inhabitant owned by a person. The strategy notes written before 2026-09-30 say **body**; "Sims" is avoided (EA's mark) |
| **Native Soul** | One of six Souls owned by `system`, seeded so the world is never empty |
| **Mind** | A Soul's non-physical state in the server: standing intent, agenda and position, the card in progress, mood, energy, recent history, next-think time |
| **Entity** | A thing in the engine's `WorldState` (`human`, `fixture`, …). A Soul's entity is its body in the world |
| **Owner** | The signed-in person a Soul belongs to |
| **Agent** | An owner's own AI assistant, paired to one Soul with a token |
| **Kernel** | `packages/kernel`, the meaning layer: things, links, five kinds of change and one rule. It replays from the log without an engine |
| **Thing** | Anything with an identity in the kernel: a Soul, a place, a gathering, something a card made. Has a `kind`, a `name`, fixed `traits`, changing `states`, the thing it is `at`, and its maker (`by`) |
| **Link** | A named connection from one thing to another (`hosts`, `attends`, `knows`, `made`…), optionally with `data` and an expiry (`until`) |
| **Control link** | A link of a kind declared `control: true` (`hosts`, `made`, `holds`). Holding one gives the right to change its target |
| **Change** | One of the five things that can happen in the kernel: appear / vanish, set, move, link / unlink, say |
| **Coherence rule** | An actor changes only itself, what it controls, and what it made. Enforced by `check()` on every change. Shared outcomes come from separate actions that fit together |
| **Said / asked / agreed** | The speech links, made only by a `say` change. `said`: last spoke to (2 minutes). `asked`: an open question, closed by an answer or after 2 minutes. `agreed`: said yes to a request (30 minutes). No card can link or unlink them |
| **Vocabulary** | The kernel's open data: kinds of thing, kinds of link, manners and cards. The base vocabulary is what a new world starts with |
| **Card** | A named, reusable action stored as data: what it is played on (`target`), when it is possible (`when`), what it changes (`then`), and how the body shows it (`approach`, `during`). The card **library** is every card in the vocabulary |
| **Deck** | The cards and manners one Soul holds. A Soul plays only cards in its deck |
| **Manner** | How an action is done (`warmly`, `shyly`…). A Soul holds a few; one is chosen per decision and colours what is said |
| **Play** | A card's changes being applied to the kernel, logged as a `play` event once the card's approach steps have run. A play can be refused |
| **Mint** | Adding a new card (and any link kinds it needs) to the vocabulary, logged as a `mint` event. Cards are minted by the compiler or proposed by an agent, and validated first |
| **Intent** | The standing direction an owner or agent gives a Soul: an agenda, or a goal from a closed list that the server turns into one. Replacing it is steering |
| **Agenda (plan)** | The ordered card steps of an intent: `{card, target?, of?}`. It says which options serve the owner; the Soul's mind still chooses every action |
| **Wish (command)** | An owner's direction in plain words. The compiler turns it into an agenda |
| **Note / text** | The owner's own words on an intent (`note`, or the wish as `text`); seen only by the owner and the Soul's mind |
| **Activity / option** | A thing a Soul could do now: a playable card on a target, with its verb steps bound (`ActivityOption`) |
| **Verb** | An atomic engine action (`walk_to`, `sit`, …) |
| **Body language** | The nine verbs both engines describe for one actor's body (`walk_to`, `sit`, `stand`, `rest`, `wave`, `converse`, `gather`, `perform`, `ambient_wander`). Card depictions are written in it. Raw Mars verbs are also reachable as `mars:<verb>` |
| **Program** | The ordered verb steps one actor's body is running, started by a decision. One actor runs one program |
| **Anchor** | A region or named place in an engine's world that the kernel mirrors as a Thing |
| **Decision** | The logged choice of an option for a Soul, by reflex or by the mid-brain. It starts a program |
| **Reflex** | The tier that decides in code, with no model call: answer a question the plan says to agree to, take the one option that serves the plan, wait for an answer |
| **Mid-brain / narrator / director** | Jev per Soul / Haiku per region / Jev for the broadcast camera. See `sim/BRAIN.md` |
| **Compiler** | The model call that turns a wish into an agenda and writes any missing cards |
| **Attune** | One Jev call that picks the three manners that suit a Soul's description |
| **Beat** | One narrator suggestion for a region; becomes a `scene` event and a nudge |
| **Scene (proposed, not built)** | One kernel Thing (a class, a meal, a crew) staged by one engine coordinator for several bodies (`eden4/19` §5). Not the `scene` log event, which carries a narrator beat |
| **Jev** | TypeSafe's System One model: returns Choice / Score / Noul judgments, never text |
| **Event, log** | An input recorded with `seq` and `tick`; the append-only log is canonical |
| **Fold** | Applying the log to the engine and the kernel tick by tick; replaying it reproduces the world |
| **Tick** | One engine step, 1/20 s of world time |
| **Snapshot** | Saved engine state + minds + kernel at a tick, for fast restart |
| **Batch / heartbeat** | WebSocket messages every 500 ms / 5 s; the heartbeat carries the view hash |
| **View hash** | Hash of every human's activity, seat and position; how a client checks its replica |
| **Replica** | A client's copy of the world built from a snapshot plus batches |
| **Path (PathCommit)** | Timed waypoints broadcast when a body moves; clients compute positions from it. The toy engine sends a whole walk, the Mars adapter short keyframes |
| **Talk line** | Words rendered for something that was said. Depiction only: the act is in the kernel |
| **Rules version** | Identifier of the engine's rules; snapshots are bound to it. **Epochs** (rule changes with migrations) are designed, not built |
| **Governor** | Splits the daily model budget into per-tier buckets |
| **Pairing** | How an agent gets a Soul token: a code from the owner, or ask-and-approve |
| **Release / staging** | A deployed build folder on the box / the instance that runs a new release before production does |
| **manna, ritual, center/frontier, rooms** | eden4 design concepts (economy, daily event, geography, interiors); none is built |
