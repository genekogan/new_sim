# World owner API: handoff, archive (co-builders: kept, off)

> **Co-builders are off (Gene, 2026-10-16: one god per world).** The co-builder calls below stay in the code for later
> but the launcher refuses them with `403 {code: "cobuilders-off"}` unless it runs with `--cobuilders` (or
> `SIM_COBUILDERS=1`, which it then passes to each world). While off, a `cobuilder:` god token is no god token at all
> (`/v1/god/*` answers `403 cobuilder.disabled`), an old co-build invitation cannot be shown or accepted, the owner can
> still list (`enabled: false`) and remove old co-builders, and handoff and archive work as before. The browser hides the
> co-builder rows.

These calls are served by the world launcher (`tools/world-launcher/handoff.mjs`, `worldops.mjs`), not by the world
itself. `<B>` is the launcher's base: `https://sim.eden.art/worlds` in production, and empty on a local launcher.
`<slug>` is the world's address, as in `<B>/w/<slug>/`.

**Who may call.** The owner's calls take `Authorization: Bearer <token>`, where the token is either the owner's sign-in
session (what the browser sends) or a god token of this world that the owner's own agent holds. Co-builder god tokens
are refused. The site admin runs `tools/world-launcher/op.mjs` on the launcher's machine; those commands are refused
through the reverse proxy. Every step is appended to `<data>/audit.jsonl`.

In the browser, the owner finds all of this under the lightning-bolt popover, in the folded section
"This world: hand on, archive" ("co-builders" joins it only when they are on).

## Owner

| Call | Body | Result |
|---|---|---|
| `GET  <B>/__sim/worlds/<slug>/cobuilders` | | `{cobuilders:[{account,at,by}], offers:[{kind,to?,expires}]}` |
| `POST <B>/__sim/worlds/<slug>/cobuilders/invite` | `{to?: accountId}` | `{code, url, expiresAt}`: a one-use link, valid 7 days |
| `POST <B>/__sim/worlds/<slug>/cobuilders/remove` | `{account}` | `{tokensRevoked}`: that person's agent tokens stop working at once |
| `POST <B>/__sim/worlds/<slug>/transfer` | `{to?: accountId}` | `{code, url, expiresAt}`: a new offer replaces any earlier one |
| `POST <B>/__sim/worlds/<slug>/offers/cancel` | | `{cancelled}` |
| `POST <B>/__sim/worlds/<slug>/archive` | `{confirm: "<slug>", reason?}` | `{id}`: the world is stopped, moved aside and removed from `/worlds` |

Each `url` opens the world page at `#worldoffer/<code>`. The receiving person signs in and presses Accept, and that
press is their consent. Nothing changes until they accept. With `to` set, only that account can accept.

## The person receiving a link

- `GET <B>/__sim/worlds/<slug>/offer?code=<code>` returns `{kind: "cobuild" | "transfer", world}`.
- `POST <B>/__sim/worlds/<slug>/offer/accept` with `{code}` must be signed in.
  - A co-build invitation makes them a co-builder.
  - A handoff makes them the world's god. The world restarts, and every earlier god token (the old owner's agents and
    every co-builder's) is revoked.

## A co-builder's agent

1. The agent calls `POST <B>/__sim/worlds/<slug>/cobuild/pair/start` with `{agent: "<its name>"}`. It gets back
   `{user_code, poll_token, approve_url}`.
2. The co-builder opens `approve_url` (`#cobuildpair/<code>`), signs in and presses "Approve my agent". The same
   approval is `POST cobuild/pair/approve {code}` with their sign-in.
3. The agent calls `POST <B>/__sim/worlds/<slug>/cobuild/pair/poll` with `{poll_token}` every 3 s. Once approved it
   receives `{approved: true, token}`, a god token labelled `cobuilder:<account>:<agent>` that works with every
   `/v1/god/*` call.

Pairings live 10 minutes and are kept in memory, so a launcher restart drops them.

A co-builder's token cannot archive the world, invite anyone, or hand the world on.

## Site admin (`op.mjs`, on the launcher's machine)

```
node tools/world-launcher/op.mjs set-claimable --port <p> [--base /worlds] --slug <slug> --claimable false|true
node tools/world-launcher/op.mjs archive-world --port <p> [--base /worlds] --slug <slug> [--reason <text>]
node tools/world-launcher/op.mjs list-archive  --port <p> [--base /worlds]
node tools/world-launcher/op.mjs restore-world --port <p> [--base /worlds] --id <archive id>
node tools/world-launcher/op.mjs audit         --port <p> [--base /worlds] [--slug <slug>]
```

**set-claimable.** `--claimable false` applies to a world that has no god. Nobody can claim it, the launcher refuses
`/v1/god/claim`, `/v1/god/mint` and `/v1/god/pair/approve` with 403 `not-claimable`, and its card says "open to visit".

**Archive and restore.**
- Archiving never deletes anything. The world's folder moves whole to `<data>/archive/<id>/world`.
- The slug stays reserved while the world is archived, so a restore brings it back under the same address, with the
  same owner and data.
