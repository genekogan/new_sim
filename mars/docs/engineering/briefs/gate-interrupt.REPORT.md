# Interrupted gate cleanup

Gate cleanup now tracks owned descendants across detached process groups while wrappers are alive, verifies process start times before signaling, and releases ownership before repeated close/timeout cleanup. SIGINT/SIGTERM first signal owned processes gracefully, then force remaining known descendants after 250 ms. Reporting waits for interruption cleanup and records cleanup errors as failures.

Validation: `node --test viewer/deploy/gate-runtime.test.mjs`: 5 pass, 0 fail/skip/TODO. Actual gate subprocess regression starts a detached HTTP descendant that ignores TERM, sends SIGINT, and verifies completed interrupted RED report, closed port, and no live descendant. Existing startup timeout/missing executable/server readiness tests pass. No engine behavior, pins, or historical content changed. Lead owns consolidated full gate.

Observed old owned leftovers on port 5491 had already exited before attempted termination; specific-port listener inspection now empty. No unrelated servers terminated.

Follow-up: latest-gate evidence selects the newest attempt directory before reading its report. An incomplete attempt with no report blocks older green evidence, including at the same HEAD. Non-directory files are ignored. Regression verifies older green evidence first, then a newer log-only attempt yields missing proof. `node --test viewer/deploy/evidence-gate.test.mjs`: 7 pass, 0 fail/skip/TODO.
