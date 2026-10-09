import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSchedule, realTimeForLocal, nextReview } from './client-schedule.mjs';
test('field spec markdown parses both clocks without executing instructions', () => {
  const text = `## Routines (world time)
- 07:30 daily · breakfast prep at commons-kitchen · 20m
- 20:30 daily · evening fire at social-eden-fire-circle · until 22:00
- 10:00 mon,thu · read at eden-library-1 · 30m
## Commitments
- 2026-10-09 18:00 EDT (real) · meet Lumen at bandstand · promised in cv_fixture
## Reviews (real time)
- daily 23:30 EDT · review day · weekly sun 20:00 EDT · review week`;
  const s = parseSchedule(text);
  assert.equal(s.routines.length, 3); assert.equal(s.reviews.length, 2);
  assert.equal(s.commitments[0].atRealMs, Date.parse('2026-10-09T22:00:00Z'));
  assert.equal(s.routines[1].durationWorldMinutes, 90);
  assert.deepEqual(parseSchedule(text), s, 'restart retains stable entry identities');
  assert.equal(nextReview(s.reviews[1], Date.parse('2026-10-09T23:00:00Z')).atRealMs, Date.parse('2026-10-12T00:00:00Z'));
  assert.equal(nextReview({ ...s.reviews[0], zone: '+05:30' }, Date.parse('2026-10-09T12:00:00Z')).atRealMs, Date.parse('2026-10-09T18:00:00Z'));
});
test('seasonal timezone uses actual offset and refuses DST ambiguity/gaps', () => {
  assert.equal(realTimeForLocal('2026-10-09', '18:00', 'America/New_York'), Date.parse('2026-10-09T22:00:00Z'));
  assert.equal(realTimeForLocal('2026-12-09', '18:00', 'America/New_York'), Date.parse('2026-12-09T23:00:00Z'));
  assert.throws(() => realTimeForLocal('2026-11-01', '01:30', 'America/New_York'), /ambiguous/);
  assert.throws(() => realTimeForLocal('2026-03-08', '02:30', 'America/New_York'), /nonexistent/);
  assert.equal(realTimeForLocal('2026-11-01', '01:30', '-04:00'), Date.parse('2026-11-01T05:30:00Z'));
});
test('invalid dates and duplicate routines refuse instead of silently moving commitments', () => {
  assert.throws(() => realTimeForLocal('2026-02-30', '18:00', 'UTC'), /Invalid real date/);
  assert.throws(() => realTimeForLocal('2026-10-09', '18:00', 'constructor'), /Timezone/);
  assert.throws(() => parseSchedule('## Routines\n- 07:30 daily · tea · 20m\n- 07:30 daily · tea · 20m'), /Duplicate/);
});
