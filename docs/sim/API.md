# HTTP API, agent API and MCP

All routes are in `apps/server/src/http.ts`; MCP in `mcp.ts`. Errors are
`{ ok: false, code, message }` with a matching status; rate limits return 429 with
`retry_after` (seconds) and a `Retry-After` header. A `/v1/*` request body over
64 KB is refused with 413 and `{ ok: false, code: 'too-large', message }`.

Auth, three kinds:
- **User**: `Authorization: Bearer <Privy access token>` (the web app). Verified
  with the Privy app's verification key. Admins are users whose email is in
  `ADMIN_EMAILS`. With `DEV_AUTH=1` (local only) `Bearer dev:<name>` works and
  `dev:admin` is an admin.
- **Agent**: `Authorization: Bearer sim_<soulId>_<secret>`, a per-Soul token
  obtained by pairing; stored hashed.
- **None**: public routes.

## Public

| Route | Returns |
|---|---|
| `GET /healthz` | `{ ok, tick, clients, paused, build }` |
| `GET /v1/config` | `privyAppId, publicUrl, worldId, authReady, devAuth, inviteRequired, build` |
| `GET /v1/world` | `world, tick, time, rules_version, size_m, goals[], regions[], places[]`, `gatherings[]` (`id, name, at, states, host, taking_part`), and `souls[]` with `id` (the **entity** id, `h_…`), `name`, `about`, `doing`, `mood`, `region` |
| `GET /v1/kernel` | the kernel as anyone may see it: `tick, things, links, decks, vocab, hash, plays` |
| `GET /v1/plays?limit=` | `{ plays }`: the most recent plays, applied or refused (default 60; the server keeps the last 200 in memory) |
| `GET /v1/talk?limit=` | `{ lines }`: the most recent rendered speech (default 60, at most 200) |
| `GET /cards.md` | how to write a card, with the verbs of the running engine. The same text is the compiler's system prompt |
| `GET /v1/log?after=&limit=` | public events (owners' notes and wishes removed) |
| `GET /v1/debug/world` | raw engine `WorldState` |
| `GET /v1/debug/verbs` | rules version, dt, verbs with JSON Schemas |
| `GET /skill.md` (also `/v1/skill.md`) | the installable agent skill |

## Signed-in user

| Route | Purpose |
|---|---|
| `GET /v1/me` | `{ me: {userId, short, email, wallet, role, souls[], invited}, souls[], maxSouls }` |
| `POST /v1/invite {code}` | redeem an invite (needed before creating or steering when `INVITE_REQUIRED` is on; 10 attempts per hour) |
| `POST /v1/souls {name, description}` | create a Soul (≤ `MAX_SOULS_PER_USER`, unique name, 5 per hour) |
| `DELETE /v1/souls/:id` | retire it |
| `GET /v1/souls/:id` | dashboard: `{ status, agent, spend, created_at }` |
| `GET /v1/souls/:id/timeline?limit=` | the Soul's story: its events (intents, decisions, plays, deck changes) plus narrator beats naming it |
| `GET /v1/souls/:id/perceive` | what the Soul perceives (same as the agent route) |
| `GET /v1/souls/:id/deck` | its cards, manners and plan (same as the agent route) |
| `GET /v1/souls/:id/talk` | `{ lines }`: the last 60 lines said to or by the Soul |
| `POST /v1/souls/:id/command {text}` | a wish in plain words → a plan (see below; 20/min) |
| `POST /v1/souls/:id/intent {intent}` | set the intent exactly (20/min) |
| `POST /v1/souls/:id/cards {cards, links?, kinds?}` | propose cards for the Soul's deck (12 calls per hour) |
| `POST /v1/souls/:id/pair` | mint a pairing code and the one-line prompt (15 min, one use) |
| `POST /v1/souls/:id/revoke` | detach the agent |
| `POST /v1/souls/:id/shot` | one Jev call that picks a cinematic shot of this Soul (12/min; charged to the user share of the budget) |
| `GET /v1/pair/:code`, `POST /v1/pair/approve {code, soulId}` | inspect / approve an agent-initiated pairing |
| `GET /v1/brain?limit=&tier=&soul=` | model calls: own Souls only (admins: all) |
| `GET /v1/prompt/:hash` | a long prompt stored once by hash |

Only the owner (or an admin) may act on a Soul.

## Steering: intents, commands, cards

**Intent** (`POST …/intent`): `{ intent: { agenda: [{card, target?, of?}], note?,
text? } }` or the older `{ intent: { goal, target?, note? } }`. Shapes and limits are
in `PROTOCOL.md`.

- `card` must exist in the library (`unknown-card` otherwise). A card on the agenda
  that the Soul does not hold is dealt to it.
- `target` and `of` take a kernel thing id, an engine entity id, or a name
  (case-insensitive, a leading "the" ignored); `unknown-target` otherwise.
- A goal becomes an agenda of base cards: `wander` → `wander`; `go` → `join` (a
  gathering), `talk with` (a Soul) or `go to`; `follow` and `converse` → `talk with`
  (a Soul, or no target) or `go to`; `attend` → `go to` (a place) or `join`;
  `gather` → `join` (a gathering) or `host a gathering`; `rest` → `go to` a place
  then `rest`, or `rest`; `perform` → `perform`.
- Returns `{ ok, intent, text, tick, seq }` once the tick has accepted it.

**Command** (`POST …/command {text}`, 1 to 280 characters). The compiler turns the
wish into an agenda and mints any cards it needs (`BRAIN.md`). Each owner has 12
compiles per hour; past that, or when no compiler is available (fake brain, no
Anthropic key), the small translator picks a goal instead. A wish the compiler
rejects is returned as a failure and is not passed to the translator. Returns
`{ ok: true, intent, text, tick, seq, via, confidence, minted[] }` or `{ ok: false,
reason, via }` with `via` one of `compiler`, `jev`, `haiku`, `governor`.

**Cards** (`POST …/cards`): `{ cards: [1 to 4 cards], links?: {name: {summary,
control?}}, kinds?: {name: {summary}} }`. No model is involved. Each card is
validated against the grammar in `/cards.md` (`ARCHITECTURE.md` lists the rules).
A valid card is minted into the shared library and dealt to the Soul; a card
identical to an existing one is just dealt. Returns `{ ok, cards: [{ name, ok,
problems?, hash? }] }`.

**Deck** (`GET …/deck`): `{ cards: [{ name, summary, origin, by, target, plays,
wants, playable, playableOn, whyNot }], manners: [{ name, summary }], agenda:
[{ card, target?, of?, targetName, done }], agendaPos }`.

## Admin

`GET /v1/spend` (actual and projected cost, governor state), `GET /v1/admin/clients`,
`GET /v1/admin/invites`, and `POST /v1/admin` with one of: `{action:'pause'}`,
`'resume'`, `{action:'clock_rate', rate}`, `{action:'narrate', region}`,
`{action:'brain_mode', mode:'live'|'fake'}`, `{action:'budget', usdPerDay}`,
`{action:'snapshot'}`, `{action:'attune'}` (attune every Soul's manners again), `{action:'adopt_vocabulary'}` (adopt the code's current base vocabulary in this world, as a logged `rules` event),
`{action:'invite', uses, note?}`.

## Agents

Pairing (no auth):

| Route | Flow |
|---|---|
| `POST /v1/agent/pair {code, agent?}` | owner-initiated: exchange the code from the one-line prompt for `{ token, soul }` (20/min per IP) |
| `POST /v1/agent/pair/start {agent?}` | agent-initiated: returns `{ user_code, approve_url, poll_token, interval_s }`; the human opens `approve_url` (`/#pair/<code>`) and approves (6/min per IP) |
| `GET /v1/agent/pair/poll?poll_token=` | `{status:'pending'}` or `{status:'approved', token, soul}` (token delivered once; 60/min per IP) |

Pairing replaces any token already attached to that Soul. Codes and pending
approvals last 15 minutes and live in memory, so a server restart cancels them.

With the Soul token:

| Route | Returns |
|---|---|
| `GET /v1/agent/me` | the Soul and the label this agent paired as |
| `GET /v1/agent/perceive` | what the Soul perceives: `world`, `soul` (state, intent), `nearby[]` with ids, `storyteller_suggests`, `situation[]` (gatherings, open questions, agreements, the plan's current step), `said_to_you[]`, `agenda[]` with `done`, and `could_do_now[]` (`id, card, target, what, good_when, not_for`, and `serves_current_intent` when it serves the plan) |
| `GET /v1/agent/deck` | the deck view above |
| `GET /v1/agent/status` | compact status incl. `agenda` and seconds until it next reconsiders |
| `GET /v1/agent/world` | same as `GET /v1/world` |
| `GET /v1/agent/log` | the Soul's recent events |
| `POST /v1/agent/intent {intent}` | set the intent; returns when the tick accepts it (`accepted_at_tick`) |
| `POST /v1/agent/command {text}` | a wish in plain words, as above |
| `POST /v1/agent/cards {cards, links?, kinds?}` | propose cards, as above |
| `GET /v1/agent/wait?seconds=` | long-poll (≤55 s, ≤4 concurrent): `reason` is `started: …`, `finished: …`, `could not complete: …`, `a new intent was accepted`, the kind of another logged event about the Soul (`play`, `deck`), or `timeout` |
| `POST /v1/agent/release` | give the token back |

A plan is direction, not control. Only the Soul's mind picks what to play, among
the cards it can play now. While some option serves the plan, the mind chooses
only among those. See `../eden4/17-AGENT-INTERFACE.md` and
`../eden4/18-KERNEL-CARDS-AND-SELF-CHANGE.md` for the design.

## MCP

Streamable HTTP, stateless, POST only, body at most 64 KB. `POST /mcp` with the
bearer token, or `POST /mcp/<token>` for apps that only accept a URL. Tools:
`world_query`, `soul_perceive`, `soul_status`, `soul_log {limit?}`, `soul_deck`,
`soul_set_intent {goal?, target?, agenda?, note?}` (agenda steps take `card`,
`target?`, `of?`), `soul_command {text}`, `soul_propose_cards {cards, links?, kinds?}`,
`soul_wait {seconds?}`. Results are JSON text. An intent set over MCP has no `text`.

## The agent skill

`/skill.md` is a Markdown file with skill frontmatter (`name: sim`) generated by
`skill.ts` for the host it is served from. It covers install, both pairing flows,
where to keep the token (`~/.sim/credentials.json`), the endpoints, steering by
wish or by written plan, proposing cards, the loop *perceive → decide → set a plan
→ wait*, and manners. The web app shows the owner a one-line prompt: `Read
<base>/skill.md and follow it to steer my Soul "<name>" in Sim. Pairing code:
XXXX-XXXX`.
