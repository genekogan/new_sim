# HTTP API, agent API and MCP

All routes are in `apps/server/src/http.ts`; MCP in `mcp.ts`. Errors are
`{ ok: false, code, message }` with a matching status; rate limits return 429 with
`retry_after` (seconds) and a `Retry-After` header.

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
| `GET /v1/config` | Privy app id, base URL, world id, `inviteRequired`, `build` |
| `GET /v1/world` | `world, tick, time, rules_version, size_m, goals[], regions[], places[]`, and `souls[]` with `id` (the **entity** id, `h_…`), `name`, `about`, `doing`, `mood`, `region` |
| `GET /v1/log?after=&limit=` | public events (owner notes removed) |
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
| `GET /v1/souls/:id/timeline?limit=` | the Soul's story: its events plus narrator beats naming it |
| `GET /v1/souls/:id/perceive` | what the Soul perceives (same as the agent route) |
| `POST /v1/souls/:id/command {text}` | plain words → translator → intent (20/min) |
| `POST /v1/souls/:id/intent {intent}` | set the intent exactly (20/min) |
| `POST /v1/souls/:id/pair` | mint a pairing code and the one-line prompt (15 min, one use) |
| `POST /v1/souls/:id/revoke` | detach the agent |
| `POST /v1/souls/:id/shot` | one Jev call that picks a cinematic shot of this Soul (12/min; charged to the user share of the budget) |
| `GET /v1/pair/:code`, `POST /v1/pair/approve {code, soulId}` | inspect / approve an agent-initiated pairing |
| `GET /v1/brain?limit=&tier=&soul=` | model calls: own Souls only (admins: all) |
| `GET /v1/prompt/:hash` | a long prompt stored once by hash |

Only the owner (or an admin) may act on a Soul.

## Admin

`GET /v1/spend` (actual and projected cost, governor state), `GET /v1/admin/clients`,
`GET /v1/admin/invites`, and `POST /v1/admin` with one of: `{action:'pause'}`,
`'resume'`, `{action:'clock_rate', rate}`, `{action:'narrate', region}`,
`{action:'brain_mode', mode:'live'|'fake'}`, `{action:'budget', usdPerDay}`,
`{action:'snapshot'}`, `{action:'invite', uses, note?}`.

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
| `GET /v1/agent/perceive` | what the Soul perceives: world words, its own state and intent, `nearby[]` with ids, storyteller suggestion, `could_do_now[]` (options flagged `serves_current_intent`) |
| `GET /v1/agent/status` | compact status incl. seconds until it next reconsiders |
| `GET /v1/agent/world` | same as `GET /v1/world` |
| `GET /v1/agent/log` | the Soul's recent events |
| `POST /v1/agent/intent {intent}` | set the intent; returns when the tick accepts it (`accepted_at_tick`) |
| `POST /v1/agent/command {text}` | fallback: let the server's translator try |
| `GET /v1/agent/wait?seconds=` | long-poll (≤55 s, ≤4 concurrent): returns on `started: …`, `finished: …`, `could not complete: …`, `a new intent was accepted`, or `timeout` |
| `POST /v1/agent/release` | give the token back |

An intent is direction, not control: only the Soul's mind picks an activity, among
options the engine enumerates. See `../eden4/17-AGENT-INTERFACE.md` for the design
questions this leaves open.

## MCP

Streamable HTTP, stateless, POST only. `POST /mcp` with the bearer token, or
`POST /mcp/<token>` for apps that only accept a URL. Tools: `world_query`,
`soul_perceive`, `soul_status`, `soul_log`, `soul_set_intent {goal, target?, note?}`,
`soul_command {text}`, `soul_wait {seconds?}`. Results are JSON text.

## The agent skill

`/skill.md` is a Markdown file with skill frontmatter (`name: sim`) generated by
`skill.ts` for the host it is served from. It covers install, both pairing flows,
where to keep the token (`~/.sim/credentials.json`), the endpoints, the loop
*perceive → decide → set intent → wait*, and manners. The web app shows the owner
a one-line prompt: `Read <base>/skill.md and follow it to steer my Soul "<name>"
in Sim. Pairing code: XXXX-XXXX`.
