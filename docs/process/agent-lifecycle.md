# Agent lifecycle

Most changes to Sim are made by coding agents, supervised by the maintainer. People follow the same path. The repo's
workflows, templates and skills implement it; this page says what each step means.

```
issue → branch → change + focused tests → proof at the PR's tier → PR → CI + review → merge → release
```

## 1. Issue

Work starts from a GitHub issue: a bug, a feature or a playtest finding. Triage labels it with an area and a proof
tier, tries a reproduction on a fake-mind world, and marks it ready for an agent or for the maintainer's decision.
Plans, briefs and status notes live in the issue and its comments, never in the tree.

## 2. Branch

Claim the issue first (assign it and add `agent:claimed`), then work on one branch, `agent/<issue>-<slug>`, in its
own worktree. Keep the change small enough to review in one sitting; split a large piece of work into issues that each
merge on their own, and put unfinished work behind a flag that defaults to off. How many agents share the repository
without coordinating: [agent workflow](agent-workflow.md).

Keep the agent's context small: read with search and line ranges, run focused commands, and summarise large outputs in
a file under `.local/` instead of pasting them. Start a fresh session rather than letting one grow without bound.

## 3. Change and focused tests

Write the change with its tests. Iterate with `node --test` on the touched files and `tsc -p` of the touched packages
([testing](../testing.md)). Run the walk, bundle or conformance check when your change can affect it. Never run a live
model locally; never point a test at production data.

## 4. Proof

[PROOF-POLICY.yml](PROOF-POLICY.yml) maps changed paths to a tier, and `node tools/proof/tier.mjs` prints yours.

| Tier | Typical change | Proof |
|---|---|---|
| T0 | docs, tools, process, CI | lint |
| T1 | server or package logic, nothing visible | focused tests and typecheck |
| T2 | visible UI or behaviour | T1 plus one uncut, real-speed clip of the changed journey on a fake-mind world (phone too when layout changed) |
| T3 | Soul behaviour, navigation, engines, shared or brittle code | T2 plus a scenario playtest with two repeats per arm, a reviewer agent pass and maintainer sign-off |
| T4 | the release head | the remote gate, live walks, cdn-walk, changelog |

**Proof levels are not equal.** A unit test proves the code does what the test says. A scripted e2e proves a script
can drive the page. Only a walk on the real URL with real input proves a person can do it. Don't call a visible change
done on the first two alone. Report what failed as plainly as what passed, and record a check you could not run as
unverified rather than passing.

## 5. Pull request

The issue's acceptance criteria are written before any code. The PR is the journal entry for the work. Open a draft
from the template:
- **Problem**, linking the issue.
- **Acceptance**: every criterion from the issue, each marked met (with evidence), `unmet:` or `deferred: #n`.
- **Proof**: clips, images and a `proof.json`, uploaded with `node tools/proof/upload.mjs`. Proof never goes in the tree.
- **Self-audit**: commands run and their results, failed attempts kept, a side-effects check (for example, the
  context a Soul sees for absent, distant and nearby objects), known limits.
- **Docs touched**, and the **changelog**.

`node tools/proof/acceptance.mjs check` validates the checklist and `proof.json` locally. The `journal` skill walks an
agent through one milestone; the `epic` skill runs a multi-milestone tranche with review stops. Add a fragment in
[`changes/`](../../changes/README.md) for anything users notice, or the `no-changelog` label. A change in behaviour
updates its doc in the same PR.

## 6. Review

CI runs the checks for the PR's paths. The required checks are `ci-ok`, `security`, `proof-ok` and the changelog
`fragment`. The `proof-check` bot keeps one comment up to date with the tier, the proof that tier needs, and which
acceptance boxes have evidence. The `claude-review` workflow reviews every push, including whether the evidence
supports each acceptance claim. `@claude` answers follow-ups, and the author answers each comment with a fix or a
reason. The maintainer reviews T3 and above and anything labelled for them. See [review](review.md).

## 7. Merge

Label the PR `merge:ready`. The merge train rebases it onto `main`, re-runs the required checks and merges: T0–T2
automatically on green, T3–T4 after the maintainer approves. A conflict it cannot resolve gets `needs:rebase`. See
[the merge train](agent-workflow.md#the-merge-train). `main` is always releasable.

## 8. Release

The release workflow ships `main`'s head: the remote gate against the cached baseline, approval for the production
environment, the staged ship with healthz, walks and cdn-walk, then the changelog and a GitHub Release. See
[release](../release.md).

## Authority

- Bug fixes need no approval. Neither do test expectation updates, baseline re-pins or skill version bumps that come
  with a reviewed change; record the reason in the commit.
- Destructive production actions (deleting worlds, data, releases or backups) need the maintainer's explicit yes.
- Agents never change permission settings, secrets or other projects' services.
