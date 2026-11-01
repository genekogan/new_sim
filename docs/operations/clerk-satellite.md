# Clerk satellite deployment

A satellite keeps the primary Clerk instance, its publishable key and issuer, and the shared account registry.
Do not replace the issuer with the satellite Frontend API hostname: account identities are bound to the issuer
and subject. Configure and verify the satellite domain and its Clerk DNS/SSL in the Clerk dashboard first.

Start the launcher with both public flags (neither is a secret):

```sh
--public-origin https://souls.game \
--clerk-satellite souls.game \
--clerk-sign-in-url https://sim.eden.art/sign-in
```

The existing authentication env file must list both `https://souls.game` and `https://sim.eden.art` in
`CLERK_AUTHORIZED_PARTIES`. The launcher refuses partial flags, a domain that does not match its public HTTPS
origin, a non-HTTPS primary URL, credentials/query/fragment in the primary URL, or a missing authorized origin.
It passes `CLERK_SATELLITE_DOMAIN` and `CLERK_SIGN_IN_URL` to its children and exposes only the public settings in
`/__sim/worlds.json` and world `/v1/config`. Deployments without flags keep the previous provider behavior.

Both homepage and world clients enable satellite options only at the exact configured satellite origin. Preview
origins remain unsigned and direct sign-in to the canonical site. The sign-in action uses Clerk's
`buildSignInUrl`, including its synchronization parameters and the complete return path, query and pairing fragment.
No simulation events, Soul context, model calls or background workers are added.

## Primary sign-in beside an older app

The primary app needs a sign-in route that allows the satellite return origin. The launcher's standalone
`/__sim/clerk-sign-in` document can be proxied on the primary domain without replacing that domain's existing app.
For example, **inside the primary site's existing Caddy block**, before its catch-all handler:

```caddy
handle /sign-in {
    rewrite * /__sim/clerk-sign-in
    reverse_proxy https://souls.game {
        header_up Host souls.game
    }
}
```

The query string must survive the rewrite. Clerk uses hash routing here, so no `/sign-in/*` subpath proxy is
needed. Before DNS points at the satellite server, use its direct upstream address with TLS server name
`souls.game`, or an authenticated transport to the launcher's loopback port; do not expose its private listener.
Keep this primary route available after cutover while the satellite uses this primary sign-in URL.

The bridge loads Clerk JS major 5 from the configured primary issuer, matching the app's Clerk React major 5.
It initializes only when the browser origin equals the configured primary origin. Query and hash return URLs
must have the exact satellite HTTPS origin; credentials and external destinations are refused before Clerk loads.
Existing primary sessions return immediately; signed-out visitors see Clerk's sign-in form. The return URL keeps
SDK synchronization parameters, world paths and pairing fragments. The page has no-store, no-referrer and
noindex headers, denies framing and supplies a CSP with a hash for its inline bootstrap and Clerk's documented
script hosts, Clerk's blob workers and the primary edge's Cloudflare analytics script. Avoid adding a second, conflicting CSP at the proxy on this route. It never renders or logs tokens.

## Verify before release

Use an isolated mirror first, then record one uncut real-speed journey on the real satellite: sign in via the
primary route, return to the same world/pairing step, reload, and verify the existing account retains ownership.
Also check an already signed-in primary session, cancellation and an unrelated-origin preview. Unit tests and
synthetic JWT integration prove configuration/identity handling; they do not prove the real Clerk session round
trip. Keep live proof explicitly unverified until this browser journey succeeds.

References: [Clerk satellite domains](https://clerk.com/docs/guides/dashboard/dns-domains/satellite-domains) and
[Clerk CSP](https://clerk.com/docs/guides/secure/best-practices/csp-headers).
