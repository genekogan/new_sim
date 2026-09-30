# 09 — Handoff prompt (paste into a new agent session in `~/Eden`)

Updated 2026-09-29 after round 8. Paste everything below the line.

---

You're taking over as my thinking partner on eden4, a new vision for Eden.
We're still brainstorming, not building. Previous Claude sessions and I did 8
rounds (2026-09-27 → 09-29) and wrote everything down in `<eden4>/`
(a separate project from eden1/2/3; the Mars world project will eventually be
a special case of it). There's also a single HTML report at
`eden4/report/eden4.html`, published as a Claude artifact at
https://claude.ai/artifact/NXCEKB153vze1nX4mDcUS5; when the docs change,
update the file and republish to that same URL.

The short version: Eden becomes a single persistent 3D world, simulated in
one place. Anyone can buy a body (an NFT) and drop in right away; the owner
names and describes it once. Bodies are always on and stay alive and
influential when their owners are idle. Owners steer them from any agent
(Claude, ChatGPT, Codex, a DAO). Every body gets daily manna UBI and spends
it to build and place art. The ground expands outward: a rich, slow,
hardening center and a poor, dynamic frontier. One ritual a day at the
center, rotating with the lunar calendar. History is canonical and
replayable while the rules evolve. Built on my Mars studio engine, as a
successor to the Abraham Covenant.

Round 8 changed things: I withdrew "one body a day for 30 years" (it caps
growth forever) and "steering gets harder over time" (the real aim was idle
bodies staying alive). I want to shelve most numbers and let the early
community settle them: shape now, numbers later. `13` holds every dial and
its trade-offs.

Where rounds 6–7 took it: the input shape is like Runway's WorldPrompt (a
genesis plus a timestamped stream of intents addressed to subjects or the
scene), but a deterministic game engine, not a video model, produces the
result. I agreed with that. Claude then proposed three layers: edge agents
produce small *structured* intents (never free text); a versioned
deterministic policy turns each body's standing intent into verbs every
tick; the engine resolves verbs into state. Intents are the logged unit;
verbs and state are recomputed. Nouns (asset defs with affordances) are
open data; verbs are the closed, versioned vocabulary. Physics is
support-only. Those are Claude's proposals, not my decisions.

Read these in order:
1. `README.md` (front door + handoff notes)
2. `06-DECISIONS-AND-OPEN-QUESTIONS.md` (Decided / Withdrawn / Leaning /
   Shelved / Open / Rejected, and "Where the discussion stands")
   and `13-PARAMETERS-AND-TRADEOFFS.md` (the dials)
3. `08-CONVERSATION-LOG.md` (how we got here, my words separate from Claude's)
4. `11-STATE-AND-UPDATE-FORMALISM.md` and `10-FRONTIER-REPRESENTATION.md`
   (the three layers, the log and fold, nouns/verbs, bodies)
5. `03` and `04` (neutrality; economy and the unit-of-a-thing problem)
6. Skim `01`, `02`, `05`, `07`, `12`. `07` lists the existing code: the Mars
   engine at `<mars-campus-repo>/` (surveyed 09-28, HEAD
   `bfdcdfc`), Abraham at `~/Dev/abraham/`, manna in eden3, poop at
   `~/Dev/poop`, and the 3,706-model Sketchfab library at
   `<lm-3d-models>/sketchfab/`. Open source only if a
   question needs it.

How to work with me:
- Be a real thinking partner: clarify, push back, give a recommendation
  instead of a survey. Conversational, not too long.
- Don't combine ideas or projects for the sake of it ("programs not
  pixels" was rejected for that).
- Prefer fewer, more elegant rules. I'm wary of adding mechanisms.
- Don't force every number. If it's a dial, put it in `13` with trade-offs.
- Never present your proposals as my decisions. Only I move things to Decided.
- After each round, update the relevant topic file, the ledger in `06`, a
  new round in `08` that keeps my words separate from yours, and the HTML
  report (republish to the artifact URL above).
- Don't start building or scoping code until I ask. The "candidate first
  slice" in `06` is not approved.
- This is a separate lane from the live eden3 insider-alpha work described
  in `~/Eden/AGENTS.md`. Don't touch that.

Open threads I haven't answered yet:
- Derived aggregates: a building = a support-connected set of pieces, a group
  = bodies whose intents share a target; plus a recurrence slot on intents
  (what Example F lacked). (rounds 6–8)
- What the daily ritual is for now that births don't wait for it (Claude's
  lean: the manna fall).
- Where newcomers land, and whether paying for a body is itself an
  attrition point.
- Q22 (intent expressiveness) and Q21 (affordance schema).

Start by telling me in a few lines what you think the two or three most
important unresolved questions are now and which to tackle first, then
let's keep going.
