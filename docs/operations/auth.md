# Auth

Signed-in actions (creating a world, owning Souls, approving an agent, god pairing) use [Clerk](https://clerk.com).
Viewing a world never needs an account. Locally, and on the loopback-only `staging` stage, worlds use dev auth
(local names, no provider).

## Clerk setup

Use a Clerk **production** instance whose Frontend API is served from your own domain; the server refuses test keys.
From the Clerk dashboard you need three public values and no secret key:

| Setting | Value |
|---|---|
| `CLERK_PUBLISHABLE_KEY` | The instance's `pk_live_...` key |
| `CLERK_ISSUER_URL` | The Frontend API origin, `https://<clerk domain>`, with no path |
| `CLERK_AUTHORIZED_PARTIES` | Comma-separated origins allowed to use sessions, e.g. `https://sim.eden.art` |

Add the site's origin to the instance's allowed origins in the dashboard. Put the three lines in an env file on the
production host, root:simworlds 0640 (the stages read `/etc/sim-worlds/production-auth.env`, named by `--auth-env` in
each stage's settings file). Never commit it or print it in logs.

## How the stages use it

The world launcher takes the file with `--auth-env <file>` (or `SIM_AUTH_ENV_FILE`) and `--public-origin <origin>`,
which must be one of the authorized parties. The launcher itself reads only the publishable key and issuer. Each world
process loads the file by path (`node --env-file`) and runs with:

```dotenv
AUTH_PROVIDER=clerk
ACCOUNT_AUTH_REQUIRED=1
DEV_AUTH=0
ACCOUNT_REGISTRY_PATH=<data>/accounts.sqlite       # forks: <data>/forks/accounts.sqlite
INVITE_REQUIRED=0
PUBLIC_URL=<public origin>
```

Without `--auth-env` the launcher uses dev auth. With Clerk, `POST /__sim/worlds` needs the creator's session token,
dev tokens are refused, and the new world is owned by that account from birth.

## Server checks

At start, `apps/server/src/auth.ts` refuses to run Clerk mode unless:

- `ACCOUNT_AUTH_REQUIRED=1`;
- `CLERK_ISSUER_URL` is an `https` origin and the publishable key is `pk_live_` and encodes that same host;
- `ACCOUNT_REGISTRY_PATH` is absolute;
- `CLERK_AUTHORIZED_PARTIES` is non-empty, holds only bare origins (`http` only for localhost), and includes the
  origin of `PUBLIC_URL`.

Each session token is verified against the issuer's JWKS (`<issuer>/.well-known/jwks.json`): RS256 only, the
configured issuer, the claims `sub`, `exp`, `iat`, `nbf`, `sid` and `azp` all present, and `azp` one of the authorized
parties. An email address or provider subject sent by a caller is never enough on its own. New accounts have ordinary
rights; there is no email-based admin role and no merging of accounts across providers.

`AUTH_PROVIDER` also accepts `none` (no provider tokens) and `privy` (the earlier provider, kept for compatibility);
the stages always run `clerk`.

## The account registry

The registry maps each exact `(issuer, subject)` pair to a random `acct_<uuid>` id. All worlds of a stage open the
same SQLite file; `BEGIN IMMEDIATE`, a unique binding and WAL with `synchronous=FULL` serialise writes. Provider ids
never become world owner ids. Memberships, delegated Soul grants and ownership history stay in each world's own
database.

Back the registry up with SQLite's online backup API (the nightly backup does), never by copying only the live main
file. Keep it through every release and rollback: losing or replacing it orphans every account's worlds and Souls.

## In the browser

The page reads the auth settings from the world's `/v1/config`. `authenticationOrigin` is the origin of the configured
`PUBLIC_URL`; only that exact origin mounts Clerk. Any other host (a preview, loopback) gets unsigned viewing of the
same world, and account actions link to the canonical world URL. Once signed in, the page exchanges the Clerk session
token at `/v1/account/session` for the opaque account id and checks that the returned issuer and subject match the
current Clerk session.

## Site owners

The health page `/__sim/health` shows its data to loopback requests and to signed-in accounts listed in
`SIM_SITE_OWNERS` (comma-separated account ids) in the launcher's environment.
