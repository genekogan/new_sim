// Frozen geometry and exact receipt choices, never text similarity or names from generated prose.
import { xz } from './run.mjs';
const at = value => typeof value === 'number' ? value : Date.parse(value);
const row = (id, status, detail, extra = {}) => ({ id, status, detail, ...extra });
const time = sample => at(sample.t);
const options = p => Array.isArray(p.anyOf) ? p.anyOf.map(branch => ({...p, ...branch, anyOf: undefined})) : [p];
const phaseMatches = (s, p) => {
  if (p.anyOf) return options(p).some(branch => phaseMatches(s, branch));
  const pos = xz(s.pos);
  if (p.region && (!pos || !pos.every(Number.isFinite) || Math.hypot(pos[0] - p.region.pos[0], pos[1] - p.region.pos[1]) > p.region.radiusM)) return false;
  if (p.receipt?.verb === 'sit' && p.receipt.targetIds?.length) {
    const held = typeof s.seat === 'string' ? s.seat : s.seat?.entityId ?? s.seat?.entity ?? s.seat?.id;
    if (!p.receipt.targetIds.includes(held)) return false;
  }
  if (p.places && !p.places.includes(s.place)) return false;
  if (p.postures && !p.postures.includes(s.posture)) return false;
  const activity = typeof s.activity === 'object' ? s.activity?.kind : s.activity;
  if (p.activities && !p.activities.includes(activity)) return false;
  if (p.level != null && s.level !== p.level) return false;
  if (p.heading != null && (!Number.isFinite(s.heading) || Math.abs(((s.heading - p.heading + 540) % 360) - 180) > (p.headingToleranceDeg ?? 30))) return false;
  return true;
};
export function validateJourney(j) {
  const errors = [];
  if (!j?.fixtureId || !j?.source) errors.push('journey requires fixtureId and immutable source');
  if (!Array.isArray(j?.phases) || !j.phases.length) errors.push('journey.phases required');
  for (const p of j?.phases ?? []) if (p.anyOf && (!Array.isArray(p.anyOf) || !p.anyOf.length)) errors.push('phase anyOf must contain alternatives');
  for (const [i, phase] of (j?.phases ?? []).entries()) for (const p of options(phase)) {
    if (!p.region || !Array.isArray(p.region.pos) || p.region.pos.length !== 2 || !p.region.pos.every(Number.isFinite) || !(p.region.radiusM > 0)) errors.push(`phase ${i} needs frozen region`);
    if (p.receipt && !p.receipt.capabilities?.length && !p.receipt.targetIds?.length && !p.receipt.targetRefs?.length) errors.push(`phase ${i} receipt needs exact capabilities/targets`);
  }
  return errors;
}
export function journeyOracles({ ev, journey: j, receipts, replies, acts, acceptedMs, endedMs }) {
  const sent = at(ev.budgetStartAt ?? ev.sentAt), cutoff = at(ev.cutoffAt);
  const samples = (ev.samples ?? []).filter(s => time(s) >= sent && time(s) <= cutoff).sort((a, b) => time(a) - time(b));
  const validReceipts = receipts.filter(r => { const t = acceptedMs(r); return t != null && t >= sent && t <= cutoff && ['accepted','waiting','started','running','completed'].includes(r.phase); });
  const choiceMatches = (r, p) => {
    const rule = p.receipt;
    if (!rule) return true;
    if (rule.verb && !r.capability?.startsWith(`${rule.verb}:`)) return false;
    const target = [r.chosen?.seat, r.chosen?.place, r.target?.id, r.target?.place].filter(x => typeof x === 'string');
    return rule.capabilities?.includes(r.capability) || rule.targetIds?.some(id => target.includes(id) || r.capability === `${rule.verb}:${id}`);
  };
  const completed = [], phaseFacts = []; let after = sent;
  for (const phase of j.phases) {
    let found = null;
    for (const p of options(phase)) {
      const eligible = samples.filter(s => time(s) >= after && phaseMatches(s, p));
      for (const s of eligible) {
        const end = time(s) + (p.holdSec ?? 0) * 1000;
        const held = samples.filter(q => time(q) >= time(s) && time(q) <= end);
        const endSample = eligible.find(q => time(q) >= end);
        if (!endSample || held.some(q => !phaseMatches(q, p))) continue;
        const holdSamples = samples.filter(q => time(q) >= time(s) && time(q) <= time(endSample));
        if (holdSamples.some(q => !phaseMatches(q,p))) continue;
        if (holdSamples.some((q,i) => i > 0 && time(q)-time(holdSamples[i-1]) > (j.maxSampleGapSec ?? 5)*1000)) continue;
        const receipt = p.receipt ? validReceipts.find(r => choiceMatches(r, p) && acceptedMs(r) <= time(endSample) && (!p.receipt.completed || (r.phase === 'completed' && endedMs(r) != null && endedMs(r) <= time(endSample)))) : null;
        if (p.receipt && !receipt) continue;
        if (!found || time(endSample) < found.at) found = { at: time(endSample), sample: endSample, receipt }; break;
      }
    }
    phaseFacts.push({ name: phase.name, passed: !!found, at: found ? new Date(found.at).toISOString() : null, receiptId: found?.receipt?.id ?? null });
    if (!found) break;
    completed.push(found); after = found.at;
  }
  const physicalAt = completed.length === j.phases.length ? after : null;
  const finalPhase = j.phases.at(-1);
  const claims = [...(ev.resultState === 'done' && ev.resultAt ? [{ text: ev.resultText, ms: at(ev.resultAt), explicit: true }] : []), ...(replies ?? []).filter(r => /\b(done|finished|completed|I(?:'m| am) (?:seated|sitting|inside)|ready to (?:present|give))\b/i.test(r.text ?? '') && !/\b(not|haven't|couldn't|cannot|can't|unable|will|I'll)\b/i.test(r.text ?? '') && !/\bstill (?:walking|trying|working|waiting|on (?:my|the) way)\b/i.test(r.text ?? ''))].filter(r => r.ms >= sent && r.ms <= cutoff);
  const claimVerdicts = claims.map(c => {
    const last = samples.filter(s => time(s) <= c.ms).at(-1);
    const fresh = last && c.ms-time(last) <= (j.maxSampleGapSec ?? 5)*1000;
    if (physicalAt != null && physicalAt <= c.ms && fresh && phaseMatches(last, finalPhase)) return 'pass';
    const finalReceipts = validReceipts.filter(r => acceptedMs(r) <= c.ms && options(finalPhase).some(p => p.receipt && choiceMatches(r,p)));
    // A completed receipt supplies a timestamped body fact. A matching observation after the claim
    // can bookend it, but must never alone backdate the Soul's posture to an earlier claim.
    const following = samples.find(s => time(s) >= c.ms && time(s)-c.ms <= (j.maxSampleGapSec ?? 5)*1000);
    const receiptProof = finalReceipts.some(r => {
      const end = endedMs(r), priorCount = j.phases.length-1;
      if (r.phase !== 'completed' || !Number.isFinite(end) || end > c.ms || c.ms-end > (j.maxSampleGapSec ?? 5)*1000 || !r.endedAt || !following) return false;
      if (completed.length < priorCount || (priorCount > 0 && completed[priorCount-1].at > end)) return false;
      if (receipts.some(q => acceptedMs(q) > end && acceptedMs(q) <= c.ms)) return false;
      return options(finalPhase).some(p => choiceMatches(r,p) && phaseMatches({...r.endedAt,pos:r.endedAt.pos},p) && phaseMatches(following,p));
    });
    if (receiptProof) return 'pass';
    if (options(finalPhase).every(p => p.receipt) && !finalReceipts.length) return 'fail';
    if (last && time(last) === c.ms && !phaseMatches(last,finalPhase)) return 'fail';
    const pending = finalReceipts.some(r => r.phase !== 'completed' || !Number.isFinite(endedMs(r)) || endedMs(r) > c.ms);
    if (fresh && !phaseMatches(last,finalPhase) && !pending && !receipts.some(r => acceptedMs(r) > time(last) && acceptedMs(r) <= c.ms)) return 'fail';
    return 'unknown';
  });
  const falseClaims = claimVerdicts.filter(v => v === 'fail');
  const truth = falseClaims.length ? 'fail' : !claims.length || claimVerdicts.includes('unknown') ? 'unknown' : 'pass';
  const accepted = validReceipts.filter(r => j.phases.some(p => options(p).some(branch => branch.receipt && choiceMatches(r, branch)))).sort((a, b) => acceptedMs(a) - acceptedMs(b))[0];
  const firstAcceptedAt = accepted ? acceptedMs(accepted) : null;
  const perceptions = acts.filter(a => /\beden(?:-agent)?\.mjs (?:here|explore|map|around|caps|observe|resolve)\b/.test(a.cmd));
  const firstPerceptionAt = perceptions.map(a => a.completedAtMs).filter(Number.isFinite).sort((a,b) => a-b)[0] ?? null;
  const discoveryBefore = firstAcceptedAt == null ? null : perceptions.filter(a => Number.isFinite(a.completedAtMs) && a.completedAtMs <= firstAcceptedAt).length;
  const metrics = { fixtureId: j.fixtureId, firstPerceptionAt: firstPerceptionAt == null ? null : new Date(firstPerceptionAt).toISOString(), firstAcceptedAt: firstAcceptedAt == null ? null : new Date(firstAcceptedAt).toISOString(), firstAcceptedSec: firstAcceptedAt == null ? null : (firstAcceptedAt - sent) / 1000, firstMovementAt: ev.firstBodyChangeAt, physicalCompleteAt: physicalAt == null ? null : new Date(physicalAt).toISOString(), physicalCompleteSec: physicalAt == null ? null : (physicalAt - sent) / 1000, completionClaimAt: claims[0] ? new Date(claims[0].ms).toISOString() : null, discoveryCallsBeforeChoice: discoveryBefore, phases: phaseFacts };
  const missing = samples.length === 0 || validateJourney(j).length > 0 || j.readiness === 'blocked';
  const efficiency = firstAcceptedAt == null ? 'unknown' : metrics.firstAcceptedSec <= (j.firstActionSec ?? 30) && (discoveryBefore == null || discoveryBefore <= (j.discoveryCalls ?? 3)) ? 'pass' : 'fail';
  return [row('journey-completion', missing ? 'unknown' : physicalAt != null ? 'pass' : 'fail', missing ? 'fixture/evidence not ready' : `${completed.length}/${j.phases.length} ordered physical predicates`, { metrics }), row('journey-truthfulness', truth, falseClaims.length ? `${falseClaims.length} completion claim(s) contradict action/body evidence` : truth === 'pass' ? 'claims follow timestamped physical completion' : claims.length ? 'sampling gap leaves state at claim unknown' : 'no completion claim'), row('journey-efficiency', efficiency, `first accepted correct target ${metrics.firstAcceptedSec ?? '?'} s; discovery calls ${discoveryBefore ?? '?'}`, { metrics })];
}
