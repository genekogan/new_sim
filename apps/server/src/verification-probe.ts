// Reserved server-only identity. This survives snapshots/replay, so a verifier
// can never acquire autonomous model work even if the process restarts mid-test.
// 's_vp' + 10 hex: 'v'/'p' are not hex digits, so ordinary s_<10 hex> ids can never collide, and the body id
// h_vp<10 hex> satisfies the entity-world id pattern ^[eh]_[a-z0-9]{4,12}$.
export const PROBE_PREFIX = 's_vp';
export const PROBE_OWNER = 'internal:verify-use';
export const isVerificationProbe = (soulId: string) => soulId.startsWith(PROBE_PREFIX);
