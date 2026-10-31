# Safety and abuse limits

What protects a world, its owner and its visitors today, and the designed next steps.

## Identity

- **Sign-in** is Clerk in production. A Clerk world refuses to start without `ACCOUNT_AUTH_REQUIRED=1`, an exact
  `https` issuer matching a `pk_live_` publishable key, an absolute `ACCOUNT_REGISTRY_PATH`, and authorized parties that
  include the world's own origin (`apps/server/src/auth.ts`).
- **Dev identities** (`DEV_AUTH=1`, `Bearer dev:<name>`) are refused on an `https` public URL and on any Clerk world.
  The launcher refuses dev auth on a public `https` origin.
- **Agent tokens** (Soul `sim_…`, god `god_…`) are random, shown once and stored only as hashes. They are bound to one
  world and revoked on handoff, retirement or owner revocation.
- **A god label is not an identity.** The `godName` shown on a world card is free text chosen at creation; the launcher
  refuses a label already shown on another account's world (409 `god-name-taken`). God mode opens only for the account
  stored as the world's owner.

## Rate limits and floods

- **Flood guard** (`apps/server/src/flood.ts`), in front of every `/v1` route unless `SIM_FLOOD=0`: per god token 10
  requests/s sustained (burst 300); per visitor address 20 writes/s (burst 600) and 40 reads/s (burst 800). Refusals
  are 429 with `Retry-After`.
- **Per-route limits** on top: pairing and approvals per IP, Soul actions per token, god edits per token per minute
  ([god mode](godmode.md#how-an-edit-works)), feedback five per minute, reminders, Eyes renders.
- **Bodies.** 1 MB for ordinary non-GET requests, 64 KB for `/v1/*` JSON, larger only for upload routes.
- **WebSocket.** 30 connections per IP, 2,000 per world, 20 messages per 10 s.

## World creation

The launcher limits how many worlds an account owns and how fast a new account creates them
([worlds](worlds.md#account-limits)), on top of global registered/running limits. Counts survive launcher restarts.
Account caps limit one identity; they do not prove that two accounts are two people.

## Uploads and moderation

Every uploaded file (Soul body models, god models and images, profile photos) passes one gate
(`apps/server/src/moderation/validate.ts`): format by magic bytes, size, triangle and texture budgets, malformed
containers refused, metadata stripped (glTF `extras`, EXIF/XMP, PNG text chunks). A clean file comes back byte-identical,
so its content address is stable. A classifier hook then allows, quarantines or rejects
(`moderation/classifier.ts`; `SIM_UPLOAD_CLASSIFIER=heuristic` selects a local stub; a classifier error quarantines).

The world's god (and the site admin, for every world) can hide content (`/v1/moderation/hide`, `unhide`; admins
`release` a quarantine). Hidden god files answer 404, hidden Soul bodies are replaced by a neutral stand-in, entities
using hidden files are left out of snapshots, and open viewers learn the new state from `/v1/world/seq` within a
heartbeat. Every action is logged.

## Model spend

Each world's paid model calls are reserved against a rolling 24-hour budget before the provider is called (default
$0.50, ceiling $1). See [brain](brain.md#the-model-budget). Launcher worlds run with the fake brain and no provider keys;
Souls' minds run, and are paid for, in their owners' own agents.

## Privacy

Owner words, private rules, journals, feedback, prompts and recovery details stay out of public projections
([contracts](contracts.md#privacy)). Feedback and owner inboxes are readable only by the world owner. Eyes pictures hide
anyone outside the Soul's sightline and use short-lived unguessable URLs.

## Design: shared invitation sponsorship (not built)

To raise the cost of many accounts, a later step would add a durable invitation record shared by every account registry:
an established owner sponsors a small weekly number of newcomers; the record keeps issuer/subject from verified sign-in,
the sponsor and the redemption time. Accounts are never joined by email or raw provider subject; IP bursts are only a
short-lived signal (families, classes and LAN parties share addresses); no device fingerprinting or mandatory payment.
Classes and workshops get a manual, audited exception. This needs a federated account registry first.

## Design: priced actions (not built)

Rate limits stop bursts, not steady abuse across days or accounts. A daily **allowance** per account would bound the
resources that run out (launcher slots and memory, disk, render time, moderation review), while an ordinary day never
reaches it.

- **Free:** viewing, walking, talking, owner instructions, a resident's own actions, god edits inside your own world.
- **Priced** (proposed defaults): create a world 40; a world awake beyond 6 free hours a day 2 per hour; a resident birth
  10; a body or model upload 5 + 1 per MB; an image upload 2; a screenshot render 1.
- **Allowance:** 150 a day, carried over up to 450; new accounts 60. All are launcher flags.
- **Mechanism:** reserve a charge before the work, settle on success, refund on failure, with an idempotent request key;
  refuse with 429 `allowance-exhausted`, the price, the balance and the refill time; show the balance in the account
  session and on the world list. Nothing existing is removed for a low balance. Operator actions are exempt and logged.
- **Not a currency:** the allowance is a usage meter, not purchasable, and never transfers between accounts.
