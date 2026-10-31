---
id: <kebab-case-id>            # matches the file name without .md
tier: smoke                    # smoke | regression
fixture: hello-hamlet          # genesis template under worlds/templates/ (fake minds, fresh data dir)
mocks: []                      # third parties the journey touches; local fake minds need none
critical_path: true            # stop at the first failed step if true
---
# <What a visitor or owner accomplishes>

<One paragraph: the user-visible outcome this scenario protects. This is the acceptance contract.>

## Preconditions
- <State that must exist before step 1, e.g. "a fresh hello-hamlet world on a free local port".>
- Isolated browser context only; never a signed-in personal profile or a production world.

## Steps
1. <Action, e.g. "Open the world and wait for the arrival card to complete.">
   - expect-url: matches /w/[a-z0-9-]+
   - expect: <narrow, checkable statement, e.g. "the world canvas is visible">
   - expect-console: no application errors
   - screenshot: arrival.png
2. <Action with real input, e.g. "Click the bench in front of the bandstand.">
   - expect: <e.g. "an object panel titled 'Bench' opens with a Sit action">
   - screenshot: panel.png
3. <Action that hits the server.>
   - expect-api: GET /w/<slug>/healthz status 200
   - expect-console: no errors since step 1 except matching <regex>

## Proof required
- <named screenshots>
- <for T2+ changes: the proof skill's uncut clip of this journey>

---
## Assertion vocabulary
- `expect:` — presence/absence in the accessibility tree or on screen (judged; keep it narrow)
- `expect-url:` — current URL matches a regex
- `expect-api:` — direct HTTP check against a world route
- `expect-console:` — console constraint ("no application errors", "no errors since step N except matching <regex>")
- `screenshot:` — save a named screenshot at this point
