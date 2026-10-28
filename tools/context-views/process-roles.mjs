// Identity-keyed accounting only. An executable is evidence, never kill authority.
export function processRoles(rows, serverPid, registry, registrations = []) {
  const key = row => `${row.pid}:${row.start}`;
  for (const { pid, role } of registrations) {
    const row = rows.find(row => row.pid === pid);
    if (row) registry.set(key(row), role);
  }
  const server = rows.find(row => row.pid === serverPid);
  if (server) registry.set(key(server), 'server');
  for (let i = 0; i < rows.length; i++) {
    let changed = false;
    for (const row of rows) {
      if (registry.has(key(row))) continue;
      const parent = rows.find(parent => parent.pid === row.parent);
      const parentRole = parent && registry.get(key(parent));
      const chrome = /(?:Google Chrome|Chromium|chrome(?:-headless-shell)?)(?: Helper[^/]*)?$/.test(row.executable ?? '');
      const role = parentRole === 'viewer' ? 'viewer'
        : parentRole === 'capture' ? 'capture'
        : parentRole === 'server' && chrome ? 'capture' : undefined;
      if (role) { registry.set(key(row), role); changed = true; }
    }
    if (!changed) break;
  }
  const processes = rows.map(row => ({ ...row, role: registry.get(key(row)) ?? 'other' }));
  const rssByRoleMiB = { server: 0, capture: 0, viewer: 0, other: 0 };
  for (const row of processes) rssByRoleMiB[row.role] += row.rssMiB;
  return { processes, rssByRoleMiB, serverCaptureRssMiB: rssByRoleMiB.server + rssByRoleMiB.capture };
}

export function resourceSummary(samples, phases) {
      const sampled = samples.filter(sample => sample.rssByRoleMiB);
      const resources = {
        samplingMs: 500, boundMiB: 2560, note: 'Sampled peaks, not OS high-water marks. Produced PNG count includes results later discarded as superseded; finish.ready is not proof of publication.',
        peakCombinedMiB: sampled.length ? Math.max(...sampled.map(sample => sample.rssMiB)) : null,
        peakServerCaptureMiB: sampled.length ? Math.max(...sampled.map(sample => sample.serverCaptureRssMiB)) : null,
        peakByRoleMiB: Object.fromEntries(['server', 'capture', 'viewer', 'other'].map(role => [role, Math.max(0, ...sampled.map(sample => sample.rssByRoleMiB[role]))])),
        unidentifiedProcesses: sampled.flatMap(sample => sample.processes.filter(p => p.role === 'other').map(p => ({ pid: p.pid, start: p.start, executable: p.executable }))),
      };
      resources.coverageByPhase = Object.fromEntries([...new Set(phases)].map(phase => [phase, {
        successful: sampled.filter(s => s.phase === phase).length,
        errors: samples.filter(s => s.phase === phase && s.error && !s.abortedForCleanup).length,
        captureSamples: sampled.filter(s => s.phase === phase && s.rssByRoleMiB.capture > 0).length,
        viewerSamples: sampled.filter(s => s.phase === phase && s.rssByRoleMiB.viewer > 0).length,
      }]));
      resources.sampleErrors = samples.filter(s => s.error && !s.abortedForCleanup);
      resources.samplingSufficient = sampled.length > 0 && sampled.some(s => s.rssByRoleMiB.capture > 0) && !resources.sampleErrors.length && !resources.unidentifiedProcesses.length &&
        (!phases.includes('explore-ui') || sampled.some(s => s.rssByRoleMiB.viewer > 0 && s.rssByRoleMiB.capture > 0));
      resources.combinedWithinBound = resources.samplingSufficient && resources.peakCombinedMiB <= 2560;
      resources.serverCaptureWithinBound = resources.samplingSufficient && resources.peakServerCaptureMiB <= 2560;
      resources.verdict = !resources.samplingSufficient ? 'unknown-insufficient-sampling' : resources.combinedWithinBound ? 'pass' : 'fail';
  return resources;
}
