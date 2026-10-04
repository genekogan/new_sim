# Preserve the fresh purpose after delayed thought

Core correction for PM C-047, after reader070df63/native47f6621. Backend opt-in
only; no V2 transport/capability or release activation.

An evaluation captures private context before awaiting the mid transport. A new
purpose publication correctly installs `new-intent-v2` and requests thought.
The old response is then detected as stale, but previously reset the trigger to
legacy `new-intent`. The first bridge's temporary planning view requires the V2
trigger, so rejecting stale thought could still prevent the requested response.

When private context changed without a newer legacy will, the stale branch now
retains the V2 wake; ordinary body news cannot erase it. When legacy will also
changed, its latest urgent wake is preserved, including explicit NOW. The default
Brain with no private-context switch keeps its prior stale-trigger behavior.
No stale choice becomes an accepted decision, and the branch clears the old
fingerprint for the next evaluation. Publication ordering still selects the
latest private revision; it does not reactivate an old optional/withdrawn purpose.

The new regression failed on070df63 because the fresh purpose produced no native
reflex choice. Its corrected run uses an actually sleeping native camp-mat body,
one injected deferred fake Jev call, a fresh ordinary campfire publication during
that call, the actual stale-response branch and the actual next-tick/controller
path. Trace: publication186, decision187, observed walking231; two private purposes
retained, no native violations, $0. The old response admits no decision. This is
simulation-time evidence, not provider/browser/network latency qualification.

Three additional delayed-call cases qualify later optional wording (no reissue
of the older immediate planning view), withdrawal (actual sleeper stays asleep)
and a later legacy NOW (first actual native choice is rest, with mandate-now).
All use synthetic transport and ordinary canonical publication/controller paths.

```
node --test --test-concurrency=1 apps/server/src/intent-response.test.ts apps/server/src/mandate.test.ts apps/server/src/compile-fence.test.ts
pnpm --filter @sim/server exec tsc --noEmit -p .
```

Final42 focused checks pass, no skips/cancellations/TODO; tsc/diff pass, fake$0.
The reproduced old failure is retained. No unchanged broad/native DJ rerun.
Historical full120/121 still fails its original receipt; the previous isolated
DJ passing invocation remains bounded evidence. Canonical physical attempts/
outcomes, sustained progress, post-admission withdrawal, private wake recovery/
retention, current opaque wire authority/final response and compatible rollback
remain the next gates. Source correction does not certify those capabilities.
