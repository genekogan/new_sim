# Selected-world agent reader producer

Core route component after native47f6621, October 4, 2026. PM requested C-042/
C-043/C-044; App supplies copy, Core HTTP, PM root/proxy/static/distribution.

`/w/<key>/llms.txt` now reaches an explicit text handler before SPA fallback.
It supplies App's selected-world reader from exact
`0b998aa760adb48cb4ddad441521814189426d20` after3df725b, adapted to TypeScript
without importing the CLI/Keychain module. Original reader source SHA256:
`0e468aa5ce8e6cae76ea1e94d73f321ad560a33038f2bb19677e8590b7b96db0`.
The independently generated output fixture retains that pin/hash and exact
four-world outputs; it was generated only after the read-only App file matched
the reviewed Git blob. No App file was edited/adopted, no root directory copied.

The reader's origin comes from server `PUBLIC_URL`, with the configured exact
`/w/<WORLD_KEY>` prefix. An origin-only PUBLIC_URL is normalized to that path;
a different path, credential URL, query/hash or insecure remote scheme refuses
with503/no-store/plain text. Caller Host, forwarded host/proto and bearer never
enter advertised links. A mismatched world-reader path returns404 text rather
than a misleading HTML reader. Existing root compatibility aliases are retained;
PM must mount the root directory and qualify real proxy/host routing separately.
Neither this route nor a root alias converts Toy credentials into Eden authority.

The actual HTTP/WS entry point's existing URL stripping is extracted unchanged
into `world-request-path.ts`, shared with the producer test. Reserved Mars2020–27
labs, other-world paths, old bare aliases and normal selected paths retain their
previous routing semantics. This is not public Toy retirement.

Proof uses real Hono/Auth/SQLite and the Node HTTP listener on owned4953 with a
SPA present. Four separate selected-world fixtures prove GET/HEAD text/plain,
actual selected skill path, no caller markers, foreign-reader404, normal SPA
fallback and configuration failure503. All sockets are closed. These are public
text-route/link checks; they do not validate the linked skill's secure setup,
real installed client/Privy/MCP, frontend, actual world bodies or proxy deployment.

```
node --test --test-concurrency=1 apps/server/src/agent-reader.test.ts apps/server/src/pair-body-poll.test.ts apps/server/src/intent-publisher.test.ts
pnpm --filter @sim/server exec tsc --noEmit -p .
```

Final34/34 checks pass, no skips/cancellations/TODO, tsc/diff pass, fake$0.
Initial reader5/7 failed from the test client's pooled sockets crossing successive
same-port worlds; each independent fixture now closes its HTTP session. The
foreign404 assertion then exposed Hono's valid upper-case charset spelling;
case-insensitive header comparison corrects that fixture. Neither failure is
relabelled a passing receipt. No broad/native test repeat for unchanged behavior.

Release dependencies remain explicit: integrate App's accepted secure skill copy
f5500f0 and reviewed client/bundle pins before claiming safe discovery-to-agent
setup. This branch still has the earlier skill copy; it only proves the reader
text and route. PM owns the root index, bundle/version/hash/artifact mount, real
public-world routing and release identity. No download/installer URL, installed
host, V2 capability/activation, new current authpolicy, main/push/deploy, accounts,
private source or paid call is introduced. Historical full120/121 remains failed;
native47f6621 isolated proof/remaining outcome-wire-rollback gates are unchanged.
