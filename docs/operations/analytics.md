# Visitor analytics

The web app counts visitors with [GoatCounter](https://www.goatcounter.com). No GoatCounter script is loaded:
`apps/web/src/visitor-counts.ts` sends GoatCounter's own count requests itself, so the page runs no third-party code.
Counting is cookieless and sends nothing personal.

## What is counted

| Count | Sent as |
|---|---|
| A world page view | path `/w/<slug>`, whatever the base (`/worlds` or root) |
| The world list | path `/` |
| Referrer | another site's origin only; one of the site's own pages as its counted path |
| Screen | its width only (GoatCounter's phone/tablet/desktop split) |
| `enter world <slug>` | event, once the arrival card is gone (or the first live frame is drawn) |
| `soul paired` | event, once per approval of a Soul for an agent |
| `god connected` | event, when a world's god is approved |

A count never carries a query string, a hash fragment, a Soul id, a pairing or window code, or a token. Events have
fixed names. Each request goes out with `sendBeacon`, falling back to an image with `referrerPolicy = 'no-referrer'`.

## What is not counted

- Local and private hosts: `localhost`, `*.localhost`, `.test`, `.local`, `.internal`, `.lan`, `.home.arpa`,
  Tailscale MagicDNS names, loopback, private, link-local and CGNAT addresses. So dev servers, tests and e2e runs never count.
- Automated browsers: `navigator.webdriver` is true for every Playwright run, including the release probe, walks,
  poster, stall and cdn-walk.
- Screenshot looks: any URL with `?shot`.
- A browser that set `localStorage.skipgc = 't'` (GoatCounter's own opt-out).
- A build with `SIM_GOATCOUNTER=off`.

## Configuration

`SIM_GOATCOUNTER` is read at build time (`apps/web/vite.config.ts`). It is a GoatCounter site code (counts go to
`https://<code>.goatcounter.com/count`), a full `http(s)` count URL for a self-hosted counter, or `off` / `0` / empty
to disable counting. Without it the build uses the site's default code from `vite.config.ts`. `release.sh` passes it
through, so a release can override it.

## Content-Security-Policy

World pages currently send only `Content-Security-Policy: frame-ancestors 'none'` (`apps/server/src/http.ts`). If a
fetch or image directive (`connect-src`, `img-src`, `default-src`) is ever added, it must allow the counter origin,
or the counts stop silently.

Tests: `apps/web/src/visitor-counts.test.ts`.
