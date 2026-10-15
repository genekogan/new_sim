// Reserved server-only identity. This survives snapshots/replay, so a verifier
// can never acquire autonomous model work even if the process restarts mid-test.
export const PROBE_PREFIX = 's_verify_';
export const PROBE_OWNER = 'internal:verify-use';
export const isVerificationProbe = (soulId: string) => soulId.startsWith(PROBE_PREFIX);
