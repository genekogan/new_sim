# Finite food availability and future arrivals (T067)

The first eight canonical birth records retain their personal resource slots.
The opt-in local provision entry now follows later birth facts and canonically
mints/deals the existing meal, sleep and tidy cards without a server restart.
Current owner/body/retirement authority is rechecked at card acceptance. Assignment
runs outside the birth listener's acceptance stack and is drained on shutdown.
Failures are visible and retained for the shutdown barrier. Catch-up is idempotent.
Retirement does not recycle a slot; the ninth lifetime birth receives no personal
resource cards or extra stock. This is an explicit eight-slot scope, not a claim
that a ten-person candidate has ten personal meals/mats.

The actual selected supplier already contains the native `eat.bowl-empty`
whole-program guard: exhausted bowls are excluded even when the first step takes
utensils. An initial assumption that this guard was missing was incorrect.
A draft prospective-policy packet duplicated that guard and failed its pre-policy
assertion (2 PASS / 1 FAIL); it is abandoned, retained as failed evidence and not
an installation candidate. No admission policy change is supplied. Recorded meal
PLAY counts alone do not establish that completed empty meals repeated.

Focused fake-$0 checks cover eight ordinary invited owner births followed by a
ninth, canonical card assignment without restart, stable slots, idempotent catch-up,
actual take/eat/put and sleep, and exact native/kernel/needs snapshot plus genesis
replay. Source and selected-runtime checks are separate. The running PM world and
real model behavior require PM installation/observation; this source milestone
does not replenish its empty food. No public/private API grammar changes.

The next physical milestone is finite supported preparation and serving. Existing
native preparation accepts two full ingredient bowls and conserves them into two
servings. Its current ground-only scope refuses any world with usable stairs,
including the commons deck: simply minting that card would be misleading. A scoped
physical extension and replay-safe resource checkpoint are required. No infinite
refill, new economy, raw need edit or actor teleport is proposed.
