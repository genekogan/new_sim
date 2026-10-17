// node --test tools/world-launcher/prewarm-room.test.mjs
// Release pre-warm runs a second process of a world beside its running one; it is skipped (cold boot, as before) when
// the unit's cgroup memory limit or the host's available memory has no room for it. Fake /proc and /sys files only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cgroupHeadroomMb, prewarmBlocked, PREWARM_MB } from './production.mjs';

const MB = 2 ** 20;
const fs = (files) => (f) => { if (!(f in files)) throw Object.assign(new Error(`ENOENT ${f}`), { code: 'ENOENT' }); return files[f]; };
const unit = (current, high = 'max', max = 'max', meminfo = 16_000) => fs({
  '/proc/self/cgroup': '0::/system.slice/system-sim\\x2dworlds.slice/sim-worlds@production.service\n',
  '/sys/fs/cgroup/system.slice/system-sim\\x2dworlds.slice/sim-worlds@production.service/memory.current': `${current * MB}\n`,
  '/sys/fs/cgroup/system.slice/system-sim\\x2dworlds.slice/sim-worlds@production.service/memory.high': `${high === 'max' ? 'max' : high * MB}\n`,
  '/sys/fs/cgroup/system.slice/system-sim\\x2dworlds.slice/sim-worlds@production.service/memory.max': `${max === 'max' ? 'max' : max * MB}\n`,
  '/proc/meminfo': `MemTotal: 16000000 kB\nMemAvailable: ${meminfo * 1024} kB\n`,
});

test('headroom is the smaller of memory.high and memory.max minus memory.current; none without a limit or off Linux', () => {
  assert.equal(cgroupHeadroomMb(unit(3000, 5120, 6144)), 2120);
  assert.equal(cgroupHeadroomMb(unit(3000, 'max', 6144)), 3144);
  assert.equal(cgroupHeadroomMb(unit(3000)), null);
  assert.equal(cgroupHeadroomMb(fs({})), null, 'macOS: no /proc');
  assert.equal(cgroupHeadroomMb(fs({ '/proc/self/cgroup': '12:memory:/x\n' })), null, 'cgroup v1');
});
test('pre-warm goes ahead with room under the unit limit and on the host, and is skipped (cold boot) without', () => {
  assert.equal(prewarmBlocked(0, { read: unit(3000, 5120, 6144) }), null);
  assert.match(prewarmBlocked(0, { read: unit(4600, 5120, 6144) }), /520 MB under its memory limit; pre-warm needs 768/);
  assert.match(prewarmBlocked(1000, { read: unit(1000, 5120, 6144, 1500) }), /1500 MB available; pre-warm needs 1768/);
  assert.equal(prewarmBlocked(0, { read: fs({}) }), null, 'macOS: no limits known, pre-warm as configured');
  assert.equal(PREWARM_MB, 768);
});
