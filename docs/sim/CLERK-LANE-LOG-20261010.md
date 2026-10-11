# Clerk publication lane log

Received 2026-10-10T06:11:32Z. Aggressive target is 2026-10-10T14:11:32Z
(10:11 EDT); the independent restoration-first target remains 13:57 UTC. Neither
full Mimos nor a 24-hour soak is a gate for already-ready restoration.

Root owns the current authoritative three-world histories, one writer per world,
normal trusted lifecycle retirement, archive retention and actual publication
cutover. This lane changes provider/hosting integration only: no database wipe,
fresh reset, old-v1 import, ownership assignment or grandfather activation.
Root separately proved retirement on a private historical qualification clone
(9→0, body/mind/token absence, preserved prefix, cold restart without seeding);
that clone is not publication data and public retirement is still pending.
The native copies under `team/previews/20261010-restoration-auth` are also private
qualification successors, not publication authorities. Canonical closed native
histories are `<team>/scratch/world-runtime/three-worlds-1b8/managed/mars`
and the sibling `littlemartians`. Eden remains
`<team>/previews/20261007-edge/eden-data`. Only Root's explicitly
rebound authoritative descriptors may feed the publication tunnel; no trial
client receipts are promoted.

Discovery found the actual Eden1 reference at `~/Dev/eden1/eden`.
`~/Eden/eden1` does not exist. The reference frontend/backend use Clerk;
its local environment is a test instance. Live `https://app.eden.art` exposes the
production instance `https://clerk.eden.art` (public-key SHA256 prefix
`abcd2171161a4656`). Its public RS256 JWKS is reachable. Known SSH `root@eden2`
works and Caddy is active. Only read-only discovery has touched the host.

Root confirmed the human's existing production Eden1 Chrome session showing the
signed-in `gene` account. This is **Eden1 session proof only**, not Sim SSO, token
verification, browser readiness/Follow, independent pairing or model proof. Do not
ask the human to sign into Eden1 again unless actual Sim reuse fails.

Implementation adds explicit provider selection, exact issuer/origin verified
Clerk sessions, a shared SQLite registry of opaque account IDs, a separate browser
binding endpoint and lazy disabled Privy integration. Existing strict Me wire,
Soul grants and provider-independent approval/CLI mechanisms remain unchanged.
No provider secret/user-profile call is needed; caller email grants no authority.

Focused offline evidence is retained separately under
`<team>/pm-integration/auth-account-20261009/clerk-publication-001`.
Original failures were preserved: an expiry test builder overwrote its own expiry,
and an expanded lifecycle fixture omitted the qualified crew-removal policy.
The corrected fixtures exercise real synthetic cryptographic verification and
mounted HTTP authority rather than replacing the verifier with trusted strings.

Publication is proposed as eden2 Caddy → loopback reverse SSH tunnel → the laptop's
qualified three-world proxy. It has an explicit laptop uptime/network dependency.
No Caddy reload, provider/DNS change, push, merge or live cutover has occurred.
Root/Core independent review precedes integration. Hosted human and independent
agent evidence remains a distinct pending gate for this provider/publication lane.
