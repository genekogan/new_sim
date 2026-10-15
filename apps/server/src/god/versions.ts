import { SKILL_VERSION } from '../../../../tools/god-skill/lib/version.mjs';

// Deployment may provide its build commit. A source-less installed build stays explicit.
const commit = process.env.SIM_SOURCE_COMMIT;
export const godVersions = Object.freeze({
  protocol: 'god/1', schema: 'god-schema/1', skill: SKILL_VERSION,
  source: commit && /^[0-9a-f]{7,40}$/i.test(commit) ? commit : 'unknown',
});
