# Account world-creation limits and the next Sybil step

The Clerk launcher checks the authenticated account before allocating a world directory or starting a child.
It counts actual owners in registered world stores, including sleeping worlds and worlds made before the cap.
Existing worlds remain usable above a newly lowered cap. Creation is serialized, and counts and account age
survive launcher restarts. Caller-supplied owner, creator and IP do not change account attribution. Failed boots
do not count. Operator-only creation is an explicit administrative exception. Dev-name launchers keep their
existing local sandbox behavior; these account limits apply to the Clerk account path.

| Launcher flag | Default | Meaning |
| --- | --- | --- |
| `--max-worlds-per-account` | 5 | Registered worlds an account may own |
| `--new-account-hours` | 24 | First verified registry sign-in starts this period |
| `--new-account-world-limit` | 2 | Total cap during that period, bounded by the ordinary cap |
| `--new-account-create-limit` | 1 | Successful worlds in the rolling new-account window |
| `--new-account-window-minutes` | 60 | Rolling window length |

The same camelCase options are accepted by `openLauncher`. Values must be positive integers. This age is
**first seen by this launcher registry**, not Clerk signup age. Age metadata missing or in the future uses the
tighter allowance. Cap refusals return409 `account-world-limit`; velocity refusals return429
`new-account-velocity` with `retry_after` seconds and `Retry-After`. The global registered/running and per-IP
limits remain in effect. No setting or existing world is changed until L1 ships this branch.

## Next step: shared invitation sponsorship with a small, recoverable cost

Account caps limit one identity; they cannot establish that two Clerk subjects are two humans. The next
bounded step should add a durable invitation sponsor and redemption record shared by every account registry.
A signed-in established owner could sponsor a small weekly number of newcomers. Record issuer/subject via
verified authentication, sponsor account ID, redemption time and new-world count. Never join accounts by
email or raw provider subject. Use IP bursts only as a short-lived abuse signal with coarse, expiring storage;
families, classrooms and a LAN party must not be treated as one person. Avoid device fingerprinting or a
mandatory phone/payment requirement for friends.

For a real friend the cost would be asking an existing player for a link, then at most an hour between their
first two worlds. They could still view worlds and use their first world immediately. A sponsor would spend
one invitation allocation and could revoke unredeemed links. This raises an attacker's cost to acquiring
trusted sponsors rather than acquiring email addresses. A manual, audited exception would cover classes and
workshops; no permanent ban should follow from a shared IP alone. Measure invitation abandonment, false
positive support requests, repeat creation bursts and sponsor concentration before tightening defaults.

Before that step can protect both `/w/*` and `/worlds`, choose an explicit registry federation/link protocol
and demonstrate two-person isolation across it. Today's registries remain separate. Upload moderation and
priced actions are later work; this slice does not claim to solve them.
