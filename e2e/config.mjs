// Client performance scenarios attach only to an explicitly owned isolated fixture.
export const config={paths:{scenarios:'e2e/scenarios',runs:'.e2e/runs'},boot:{buildArtifacts:['apps/web/dist/index.html'],buildCommand:'Production bundles are built from committed archives on Modal; see E2E.md.'},ports:{app:7830,candidate:7834,control:7835,cdp:7838,phone:7839},iterationCap:3};
