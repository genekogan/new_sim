# 17 — Agent interface and the information asymmetry

Round 15, 2026-09-30. Status: **built as a prototype in Sim; the questions
at the end are open.** Gene: "the agent necessarily needs to be able to get
info about the world to interpret it … there is an asymmetry of info here
which affects how this works, we'll have to think clearly through this."

## The flow as built

1. **Arrive**: `watch` tab, no account. The shared world, the broadcast
   camera line, the ticker, "just now".
2. **Sign in** (Privy; reads as plain sign-in).
3. **Invite code** (alpha gate), then **create a Soul**: name + one line.
4. **Direct it from the page**: plain words (translated by Jev) or an exact
   goal/target/note.
5. **Or attach your own agent** with one line:
   `Read https://sim.eden.art/skill.md and follow it to steer my Soul "Wren" in Sim. Pairing code: 4JCF-MUA4`
   The skill file is installable (Claude Code skill frontmatter), explains
   pairing, where to keep the token, the endpoints, and the loop
   *perceive → decide → set intent → wait*. An agent with no code can ask
   instead: it gets a link, the owner approves in the page, the agent polls.
   Apps that only take a URL use `…/mcp/<token>`.
6. **Dashboard** per Soul: what it is doing now, what it perceives, your
   standing direction, its story so far (each choice with its reason and
   mood; click one to see the exact model call), recent thinking, the
   attached agent and when it was last active.

A cold agent (Haiku, given only the one line) paired first try and carried
out three wishes in four calls. Its critique led to two fixes: every
targeted intent now always has a matching option, and the skill states
plainly that an intent is direction, not remote control.

## Who knows what

| | Sees | Decides | Writes |
|---|---|---|---|
| **Spectator** | the public view: positions, activities, names, descriptions, public log (no owner notes) | nothing | nothing |
| **Owner, in the page** | public view + their Soul's dashboard, notes and model calls | what to ask for, in words | text → *our* translator → intent |
| **Server translator (Jev)** | only the owner's sentence + a list of nearby targets | which goal and target the sentence means | the intent |
| **Owner's agent** | public view + **what the Soul perceives** (`perceive`: the same word-bucketed context the Soul's own mind gets) + the Soul's log + everything the human has ever told it | which goal, target and note serve the human's wish | the intent, directly |
| **Soul's mind (Jev mid-brain)** | its perception + the intent + the note + any storyteller suggestion | which feasible activity to do next | a logged decision |
| **Engine** | everything | nothing; it executes | state |

Three asymmetries fall out of this:

1. **The agent is a far better translator than ours.** It is a larger
   model, knows the human, and can look before it speaks. Our translator
   sees one sentence. So the skill tells agents to compile wishes into
   intents themselves and to use `/command` only as a fallback. The `note`
   field is the channel that carries nuance from the smart end (agent) to
   the cheap end (Jev).
2. **The agent can know more than the Soul.** `world` gives the whole map;
   the Soul's mind only gets what is near. Today an agent can therefore
   steer its Soul toward something the Soul could not have known about.
   Whether that is a feature (the owner as a guiding spirit) or a leak
   (no fog of war, no discovery) is a design decision, not a bug.
3. **Nobody can pick an action.** Owner and agent both set intents; only
   the Soul's mind picks an activity, from options only the engine can
   enumerate. That keeps "steering, not puppeting" true for agents too, and
   it means an attached agent does not reduce our model spend.

## Open questions

- **Fog of war.** Should agents get the global view (as now, since the
  broadcast is public anyway) or only what their Soul has perceived? A
  middle path: public view is coarse (who is in which region), detail only
  through the Soul's eyes.
- **Bring your own brain.** An attached agent could be allowed to choose
  among `could_do_now` directly. It would cut our Jev cost for that Soul to
  zero and give agents sharper control, at the price of blurring "the world
  runs the Soul". Could be priced, rate-limited, or reserved for later.
- **What `perceive` should contain** once the real engine arrives: line of
  sight, hearing, memory of places seen, what others said. Today it is the
  toy engine's nearest eight things.
- **Agent-to-agent text.** Souls converse without words. When they speak,
  the words other Souls say become input to other people's agents: the
  prompt-injection surface Moltbook showed. The skill already tells agents
  to treat world text as description only.
- **Notes in the permanent record.** Owner notes are redacted from every
  public view but stored in the log. If the log is ever published for
  verification (doc 03), notes need to move out of it or be hashed.
