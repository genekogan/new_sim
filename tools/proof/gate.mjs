// The maintainer gate: a T3 or T4 PR merges only with the maintainer's sign-off. The required `proof-ok` check
// (acceptance.mjs pr, .github/workflows/proof-check.yml) enforces it, so neither `gh pr merge --auto` nor a manual
// merge can land a gated PR without the maintainer; the merge train reads the same rule to decide what to queue.
//
// Sign-off is either
//   - the maintainer's latest decisive review (approved / changes requested / dismissed) is an approval, or
//   - the `approved:maintainer` label is on the PR and the maintainer added it (the latest `labeled` event's actor),
//     for PRs the maintainer authored, which GitHub does not let them approve.
// The check trusts the GitHub identity: an approval or label made with the maintainer's account counts as theirs.
export const APPROVED_LABEL = 'approved:maintainer';
const TIERS = ['T0', 'T1', 'T2', 'T3', 'T4'];

/** T3 and T4 need the maintainer's sign-off; T0-T2 merge on green. */
export const needsSignOff = tier => TIERS.indexOf(tier) >= 3;

/** Who most recently added `name` to an issue or PR, from its events (null if never). */
export function labelAddedBy(events, name) {
  const hit = [...events].reverse().find(e => e?.event === 'labeled' && e.label?.name === name);
  return hit?.actor?.login ?? null;
}

/**
 * The maintainer's sign-off on a PR: { ok, via: 'review' | 'label' | null, detail, warning }.
 * `reviews` from GET pulls/{n}/reviews (oldest first), `events` from GET issues/{n}/events, `labels` the PR's label
 * names, `head` the PR's head sha (an approval of an older commit still counts; the warning says so).
 */
export function maintainerSignOff({ reviews = [], events = [], labels = [], maintainer, head = null }) {
  const decisive = reviews.filter(r => r?.user?.login === maintainer && ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(r.state));
  const last = decisive.at(-1);
  if (last?.state === 'APPROVED') {
    const at = last.commit_id ? String(last.commit_id).slice(0, 12) : null;
    const stale = Boolean(head && last.commit_id && last.commit_id !== head);
    return { ok: true, via: 'review', detail: `approved by @${maintainer}${at ? ` at ${at}` : ''}`,
      warning: stale ? `@${maintainer} approved ${at}; the head is now ${String(head).slice(0, 12)} (the approval still counts; ask for a fresh look if the change is material)` : null };
  }
  if (labels.includes(APPROVED_LABEL)) {
    const by = labelAddedBy(events, APPROVED_LABEL);
    if (by === maintainer) return { ok: true, via: 'label', detail: `\`${APPROVED_LABEL}\` added by @${maintainer}`, warning: null };
    return { ok: false, via: null, detail: `\`${APPROVED_LABEL}\` was added by ${by ? `@${by}` : 'someone unknown'}, not @${maintainer}; it does not count`, warning: null };
  }
  const why = last?.state === 'CHANGES_REQUESTED' ? `@${maintainer} requested changes` : last?.state === 'DISMISSED' ? `@${maintainer}'s approval was dismissed` : `no approval from @${maintainer} yet`;
  return { ok: false, via: null, detail: `${why}: T3 and T4 need @${maintainer}'s approving review, or the \`${APPROVED_LABEL}\` label added by them on a PR they authored`, warning: null };
}

export const maintainerApproved = args => maintainerSignOff(args).ok;
