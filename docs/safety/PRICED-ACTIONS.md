# Priced actions — design (G7, step after account caps)

Status: design only, 2026-10-16. Nothing here is built. Builds on `WORLD-CREATION.md` (per-account world
cap, new-account velocity) and its Sybil plan (sponsored invitations). The in-world manna economy
(`eden4/04`, `eden4/21`) stays deferred; this is a usage meter that can later be denominated in manna.

## Problem
Rate limits (per IP, per user, per resident) stop bursts but not steady abuse: a patient account, or ten
accounts, can still fill disk with uploads, hold world slots awake, and birth residents all day. The
resources that run out are Eden's, not the player's: launcher RAM and slots, disk, render time, moderation
review time, and (if ever enabled) paid generation. Priced actions bound each account's **daily total** of
those resources, so the cost of abuse grows with the abuse and with the number of accounts, while an
ordinary friend's day never hits it.

## What is priced, what stays free
Free, always: viewing, walking, talking, owner instructions and a resident's own actions (already rate
limited), Godmode edits inside your own world (geometry is cheap; storms and lightning keep WD7's limits).

| Action (where charged) | Resource | Default price |
| --- | --- | ---: |
| Create a world (launcher, before allocation) | slot, disk, RAM at boot | 40 |
| World awake beyond 6 free hours per day (launcher, hourly) | running slot, RAM | 2 / hour |
| Resident birth (world server, at approval) | DB rows, per-tick cost | 10 |
| Body or model upload (world server) | disk, moderation review | 5 + 1 per MB |
| Image upload (world server) | disk, moderation review | 2 |
| Screenshot render (world server) | render time | 1 |
| Paid generation, if ever enabled | real money | pass-through at Eden's manna price |

Daily allowance: **150**, refilled at 00:00 UTC, carried over up to **450** (no hoarding beyond three days).
Accounts younger than `--new-account-hours` get **60**. A normal friend's day (one world, two residents,
five 2 MB bodies, ten screenshots) is 40 + 20 + 35 + 10 = 105. All numbers are launcher flags with these
defaults, like the world-creation dials, and must be positive integers.

## Mechanism
- Ledger in the same account registry the caps use (one SQLite file per registry):
  `account_allowance_v1(account_id, day, granted, spent)` and
  `account_charges_v1(id, account_id, action, cost, world_id, at, request_key UNIQUE, state)`.
- **Reserve, then settle.** A charge is reserved inside `BEGIN IMMEDIATE` before any work; it settles on
  success and is refunded on failure (a failed boot or rejected upload costs nothing, matching the cap).
  `request_key` makes retries idempotent.
- Refusal is honest and specific: HTTP 429, code `allowance-exhausted`, the action's price, the balance,
  `refill_at` and `Retry-After`. Existing worlds, residents and uploads are never removed for a low balance.
- The balance is shown in `/v1/account/session` and on `/worlds`, so a person sees it before they hit it.
- Operator creations (`/__sim/op/*`, loopback only) are exempt and logged as `operator` charges at price 0.
- Burst rate limits stay; prices bound totals over days, rate limits bound seconds and minutes.

## Against many accounts
A Sybil swarm gets one small young allowance per account, and the sponsored-invitation step makes each new
account cost a trusted sponsor's invitation. Allowances never transfer between accounts in this slice, so
pooling is impossible. Classes and workshops get a manual, logged grant (operator `grant` with a reason).

## Limits and open decisions
- Registries are split (`G2-REGISTRY-AND-INVENTORY.md`): old `/w/*` worlds and `/worlds` would keep separate
  ledgers until the registries are federated. Charge `/worlds` first; that is where strangers create.
- Whether the allowance can ever be bought, or becomes manna, is Gene's D3 (venture or mission). The default
  here is **not purchasable**: a usage meter, not a currency.
- First slice (about a day): ledger module with reserve/settle/refund tests, the world-creation charge in
  the launcher, balance in the session payload. Then residents, uploads and screenshots in the world server.
