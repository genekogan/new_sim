# Contributing to Sim

Thanks for helping. Sim is developed mostly by coding agents working with the maintainer, and agents are welcome
contributors here: the same rules apply to everyone, and they are written down in [AGENTS.md](AGENTS.md).

## Setup

```sh
pnpm install --frozen-lockfile
pnpm assets:pull
cp .env.example .env
```

Details, environment variables and running other worlds: [docs/development.md](docs/development.md).

## The flow

1. **Start from an issue.** Use the bug or feature template. For anything large, agree the approach in the issue
   before writing code.
2. **Branch** from `main`. One branch per issue; keep the change small and focused.
3. **Change and test.** Add or update tests with the code. Update the doc that describes any behaviour you change.
4. **Prove it at your tier.** `node tools/proof/tier.mjs` prints your change's proof tier from
   [docs/process/PROOF-POLICY.yml](docs/process/PROOF-POLICY.yml). Visible changes need an uncut, real-speed clip of
   the changed journey on a fake-mind world; Soul, navigation and engine changes need a scenario playtest. See
   [docs/process/agent-lifecycle.md](docs/process/agent-lifecycle.md).
5. **Add a changelog fragment** in `changes/` if people using Sim will notice the change: one line, written for them.
   The format is in [changes/README.md](changes/README.md). Otherwise ask for the `no-changelog` label.
6. **Open a pull request** from the template. Put proof (clips, logs) in the PR, never in the tree.
7. **Review.** CI and a reviewer agent run on every push; answer each comment with a fix or a reason. The maintainer
   reviews T3 changes and above.

## Checks to run

```sh
pnpm typecheck                                              # or tsc -p for the packages you touched
node --test <the test files you touched>                    # focused tests
node tools/test-harness/walk/walk.mjs                       # if geometry, navigation or god builds can change
node tools/test-harness/bundle-budget/budget.mjs --build --check   # if the web app changed
pnpm --filter @sim/conformance test                         # if library defs, generators or the compiler changed
node tools/changelog/compile.mjs --check                    # if you added a fragment
```

What each check means and when to run it: [docs/testing.md](docs/testing.md). Don't run a live model locally
(`BRAIN_MODE=fake`), and don't point tests at production data.

## Baselines and pins

A walk or bundle baseline update, or a conformance supplement, goes in its own commit with the reason in the message.
Never edit an older conformance supplement. Reviewers read the numbers.

## Commits

- Imperative, scoped subject lines: `fix(nav): keep basement rooms out of default mesh entry`.
- Explain why in the body when it isn't obvious.
- Agents add their co-author trailer.

## Never commit

Secrets, `.env` or `deploy.env`, databases, run outputs, screenshots, media (it lives on the asset CDN; see
[ASSETS.md](ASSETS.md)), or status, brief and report files. A secret scanner runs on every PR; never bypass hooks.

## Licence

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE). Media is handled
separately; see [ASSETS.md](ASSETS.md). Security issues: [SECURITY.md](SECURITY.md), not public issues.
