# Clerk and stable-domain publication

The production reference is `https://app.eden.art`, whose public Clerk script and
publishable key identify `https://clerk.eden.art`. The local reference checkout is
`~/Dev/eden1/eden`; its checked-out local environment selects a **test**
instance and must not be used for Sim production. No Eden1 or Clerk setting changes
are part of this deployment.

Set these process settings explicitly for all three current world readers:

```dotenv
AUTH_PROVIDER=clerk
ACCOUNT_AUTH_REQUIRED=1
DEV_AUTH=0
CLERK_ISSUER_URL=https://clerk.eden.art
CLERK_PUBLISHABLE_KEY=<same public production key as app.eden.art>
CLERK_AUTHORIZED_PARTIES=https://sim.eden.art
ACCOUNT_REGISTRY_PATH=<one absolute durable shared identity-registry path>
INVITE_REQUIRED=0
SEED_NATIVES=0
```

Each world descriptor supplies `publicOrigin:"https://sim.eden.art"` and its own
existing world ID, closed authoritative data path and qualified source/configuration.
Eden supplies `accountAuth:true`; Mars/LM additionally select `authMode:"configured"`,
`accountAuth:true`, `seedCast:false`, `nativeCast:false`. These settings do not reset,
seed, retire, revive or reassign any Soul. Root owns ordinary preseason retirement.

The verifier uses the selected exact issuer's public JWKS, RS256 signatures,
expiry/not-before and required session/authorized-party claims. A caller email or
provider-subject string is insufficient. This requires no secret Clerk key or user
profile API. New Clerk accounts have ordinary user rights; there is no email-based
admin assignment or cross-provider account merge. `AUTH_PROVIDER=none` accepts no
provider token; `privy` retains the old explicit rollback path. In Clerk mode the
browser does not load the lazy Privy integration and the server never initializes
or authenticates Privy.

The identity registry stores a random `acct_...` ID for the exact `(issuer,subject)`
pair. All world processes open the same file; SQLite `BEGIN IMMEDIATE`, the unique
binding and FULL/WAL durability serialize writes. No provider ID becomes a world
owner ID. World memberships, delegated Soul grants, immutable birth ownership and
history remain in each world's DB. Back up the registry independently with the
SQLite online backup API (or after all registry connections close), never by copying
only a live main SQLite file. Retain the registry and world data through deployment
or provider rollback; losing/replacing it would orphan account associations.

The browser obtains its opaque ID from `/v1/account/session` using a normal verified
Clerk session token, checks the returned exact issuer/subject against the current
Clerk session, and reuses the existing private-authority generation and account
switch guards. The strict private `Me` wire is unchanged for existing clients.

## Publication proposal; Root applies only after review

The smallest first increment is Caddy on eden2 forwarding the whole Sim site to a
loopback reverse SSH tunnel. Keep current three-world routing inside the qualified
local proxy; Caddy must not select old per-world ports. A proposed tunnel is:

```sh
ssh -NT -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
  -R 127.0.0.1:4505:127.0.0.1:4970 root@eden2
```

This depends on the laptop staying awake, connected and running the three worlds,
proxy and tunnel. A dropped tunnel yields an honest gateway failure, not an old-world
fallback. The existing production block in `/etc/caddy/sites/sim.caddy` becomes:

```caddy
https://sim.eden.art, https://<eden2-sslip-host> {
  encode zstd gzip
  header X-Robots-Tag "noindex, nofollow"
  reverse_proxy 127.0.0.1:4505
}
```

Keep the separate staging block unchanged. Clerk login is qualified only on
`sim.eden.art`; the sslip alias is viewing-only and not an authorized party.
Before changing routing, Root backs up the exact current Caddy site, stages the
candidate, validates the full configuration with `caddy validate`, confirms the
tunnel/proxy endpoints and exact three world IDs/builds, assets, `/instructions.md`,
agent download URLs and HTTP/WS behavior. Reload Caddy after review. Do not overwrite
any remote world database or publish qualification clones.

The captured old Caddy site routes to outdated v1 histories. Restore that exact
site only BEFORE the new runtime accepts any writes. After acceptance, rollback
must keep routing to the current authoritative histories with the minimum lifecycle
and account readers, or expose a maintenance/unsigned fallback on those same
histories. Never reactivate the old v1 backend as current history. Keep the global
account registry and delegated grants through every rollback. Explicit provider
rollback needs its own qualification: Clerk and Privy subjects are distinct, and
existing Clerk accounts may require human relinking. Do not merge by email,
reassign owners, reset accounts or restore an older world database.

## Qualification boundaries

Offline synthetic JWT and mounted approval tests exercise actual signature/origin
checks, opaque identity persistence across world DBs and a child process, unsigned
create rejection, ready-body delegation, account isolation and revocation. Prior
provider-independent idempotence/restart/cancel/expiry/queued-authority and CLI
proofs remain separate. They do not prove hosted human login, cross-subdomain SSO,
Google/MFA, browser readiness/Follow, independent human-agent pairing, or live model
execution. Root confirmed the human's existing Eden1 session; Sim proof remains
pending until the reviewed build is reachable at its authorized production origin.

The public config now exposes `authenticationOrigin` from the configured Clerk
application URL, independently of the request-derived `publicUrl`. Only that exact
origin mounts Clerk. Trycloudflare, loopback and other preview hosts retain unsigned
viewing on the same runtime; account actions link to the canonical world, preserving
only valid Soul/approval fragments or `#join`. Clerk approval links also use the
configured canonical world URL. No preview origin is added to the server azp list.
