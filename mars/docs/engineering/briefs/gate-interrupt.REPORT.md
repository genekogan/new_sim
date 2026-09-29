# Interrupted gate cleanup

Gate cleanup now tracks owned descendants across detached process groups while wrappers are alive, verifies process start times before signaling, and releases ownership before repeated close/timeout cleanup. SIGINT/SIGTERM first signal owned processes gracefully, then force remaining known descendants after 250 ms. Reporting waits for interruption cleanup and records cleanup errors as failures.

Validation: `node --test viewer/deploy/gate-runtime.test.mjs`: 5 pass, 0 fail/skip/TODO. Actual gate subprocess regression starts a detached HTTP descendant that ignores TERM, sends SIGINT, and verifies completed interrupted RED report, closed port, and no live descendant. Existing startup timeout/missing executable/server readiness tests pass. No engine behavior, pins, or historical content changed. Lead owns consolidated full gate.

Observed old owned leftovers on port 5491 had already exited before attempted termination; specific-port listener inspection now empty. No unrelated servers terminated.
