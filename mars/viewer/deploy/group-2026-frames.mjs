// Offline, deterministic interpretation of the 2026 CAD rack fragments.
// The manifest supplies source dimensions; the scene supplies world-space prisms.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const scenePath = resolve(root, 'viewer/public/engine/campus-2026.json');
const manifestPath = resolve(root, 'viewer/public/modular/components.json');
const outputPath = resolve(root, 'docs/engineering/data/campus-2026-frames.json');
const reportPath = resolve(root, 'docs/engineering/data/campus-2026-frames-unclassified.md');
const svgPath = resolve(root, 'docs/engineering/data/campus-2026-frames.svg');

export const tolerances = Object.freeze({
  postMinHeightM: 2,
  postMaxSectionM: 0.2,
  coincidentPostM: 0.02,
  postBaseM: 0.02,
  postHeightM: 0.02,
  frameSpacingMinM: 0.85,
  frameSpacingMaxM: 1.15,
  frameHeightFitM: 0.02,
  frameDepthFitM: 0.01,
  memberPlaneM: 0.16,
  memberEndSlackM: 0.12,
  memberHeightSlackM: 0.08,
  beamLengthFitM: 0.02,
  beamEndM: 0.12,
  beamPerpendicularDot: 0.08,
});
const frameCatalog = [
  ['upright-8ft', 2.4384, 1.2192], ['upright-9ft', 2.7432, 1.2192],
  ['upright-12ft', 3.6576, 1.2192], ['upright-16ft', 4.8768, 0.9144],
  ['upright-19ft', 5.7912, 0.9144],
];
const beamCatalog = [
  ['beam-8ft', 2.4384], ['beam-9ft', 2.7432], ['beam-12ft', 3.6576],
];
const n3 = (n) => Math.round(n * 1000) / 1000;
const rad3 = (n) => Math.round(n * 1000) / 1000;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const norm = (a) => { const d = Math.hypot(...a); return [a[0] / d, a[1] / d]; };
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const ordinal = (id) => Number(id.match(/-(\d+)$/)?.[1] ?? NaN);
const reason = (component, assembly, code, detail) => ({ component, assembly, code, reason: detail });

function sourceRecords(scene, manifest) {
  const rows = new Map();
  for (const row of scene.obstacles) {
    if (!rows.has(row[12])) rows.set(row[12], []);
    rows.get(row[12]).push(row);
  }
  return manifest.instances.filter((i) => i.kind === 'rack_member' || i.kind === 'beam_candidate')
    .sort((a, b) => compare(a.id, b.id)).map((i) => {
      const b = i.cad_bounds_m;
      const spans = b[0].map((v, j) => b[1][j] - v);
      const rs = rows.get(i.id) ?? [];
      const row = [...rs].sort((a, b) => (b[4] * b[5]) - (a[4] * a[5]) || compare(a[0], b[0]))[0];
      return {
        id: i.id, kind: i.kind, assembly: i.assembly_id, sourceAncestors: i.source_ancestors,
        spans, base: b[0][2], top: b[1][2],
        // Scene x/z and yaw include the CAD-to-campus transform and assembly placement.
        pos: row ? [row[2], row[3]] : null,
        yaw: row?.[6] ?? null, half: row ? [row[4], row[5]] : null,
        rows: rs,
      };
    });
}

export function groupRecords(records, source = {}) {
  const sorted = [...records].sort((a, b) => compare(a.id, b.id));
  const unclassified = [];
  const posts = [], members = [], beamCandidates = [];
  for (const r of sorted) {
    if (!r.pos) { unclassified.push(reason(r.id, r.assembly, 'no-scene-prism', 'manifest component has no 2026 scene prism')); continue; }
    if (r.kind === 'beam_candidate') { beamCandidates.push(r); continue; }
    if (r.spans[2] > tolerances.postMinHeightM && Math.max(r.spans[0], r.spans[1]) <= tolerances.postMaxSectionM) posts.push(r);
    else members.push(r);
  }
  const unique = [];
  for (const p of posts) {
    const duplicate = unique.find((u) => u.assembly === p.assembly && dist(u.pos, p.pos) <= tolerances.coincidentPostM &&
      Math.abs(u.base - p.base) <= tolerances.postBaseM && Math.abs(u.top - p.top) <= tolerances.postHeightM);
    if (duplicate) unclassified.push(reason(p.id, p.assembly, 'coincident-post', `post overlaps ${duplicate.id} within ${tolerances.coincidentPostM} m`));
    else unique.push(p);
  }
  const edges = [];
  for (let i = 0; i < unique.length; i++) for (let j = i + 1; j < unique.length; j++) {
    const a = unique[i], b = unique[j], d = dist(a.pos, b.pos);
    if (a.assembly !== b.assembly || d < tolerances.frameSpacingMinM || d > tolerances.frameSpacingMaxM) continue;
    if (Math.abs(a.base - b.base) > tolerances.postBaseM || Math.abs((a.top - a.base) - (b.top - b.base)) > tolerances.postHeightM) continue;
    edges.push({ a, b, d, score: Math.abs(d - 1.02) });
  }
  edges.sort((a, b) => a.score - b.score || compare(a.a.id, b.a.id) || compare(a.b.id, b.b.id));
  const used = new Set(), frames = [];
  for (const e of edges) {
    if (used.has(e.a.id) || used.has(e.b.id)) continue;
    const ps = [e.a, e.b].sort((a, b) => compare(a.id, b.id));
    const midpoint = [(e.a.pos[0] + e.b.pos[0]) / 2, (e.a.pos[1] + e.b.pos[1]) / 2];
    const h = ((e.a.top - e.a.base) + (e.b.top - e.b.base)) / 2;
    const fit = frameCatalog.map(([id, height, depth]) => ({ id, heightErr: n3(h - height), depthErr: n3(e.d - depth), score: Math.abs(h - height) + Math.abs(e.d - depth) }));
    fit.sort((a, b) => a.score - b.score || compare(a.id, b.id));
    const best = fit[0];
    const catalogDef = Math.abs(best.heightErr) <= tolerances.frameHeightFitM && Math.abs(best.depthErr) <= tolerances.frameDepthFitM ? best.id : null;
    frames.push({ id: '', assembly: e.a.assembly, posts: ps.map((p) => p.id), members: [],
      base: [n3(midpoint[0]), n3((e.a.base + e.b.base) / 2), n3(midpoint[1])],
      yaw: rad3((Math.atan2(e.b.pos[1] - e.a.pos[1], e.b.pos[0] - e.a.pos[0]) + Math.PI) % Math.PI),
      height: n3(h), depth: n3(e.d), catalogDef,
      fit: { nearest: best.id, heightErr: best.heightErr, depthErr: best.depthErr },
      confidence: catalogDef ? 'inferred' : 'provisional',
      _a: e.a, _b: e.b, _across: norm(sub(e.b.pos, e.a.pos)), _centre: midpoint,
    });
    used.add(e.a.id); used.add(e.b.id);
  }
  frames.sort((a, b) => compare(a.assembly, b.assembly) || compare(a.posts[0], b.posts[0]));
  const byAssemblyNumber = new Map();
  for (const f of frames) {
    const next = (byAssemblyNumber.get(f.assembly) ?? 0) + 1;
    byAssemblyNumber.set(f.assembly, next);
    f.id = `frame-2026-${f.assembly}-${String(next).padStart(3, '0')}`;
  }
  for (const p of unique) if (!used.has(p.id)) {
    const candidates = posts.filter((q) => q.id !== p.id && q.assembly === p.assembly && dist(q.pos, p.pos) >= tolerances.frameSpacingMinM && dist(q.pos, p.pos) <= tolerances.frameSpacingMaxM);
    const mismatch = candidates.some((q) => Math.abs(q.base - p.base) > tolerances.postBaseM || Math.abs((q.top - q.base) - (p.top - p.base)) > tolerances.postHeightM);
    unclassified.push(reason(p.id, p.assembly, mismatch ? 'post-height-mismatch' : 'lone-post', mismatch ? 'nearby post differs in base or height' : 'no free partner at frame spacing'));
  }
  for (const m of members) {
    const hits = frames.map((f) => {
      if (f.assembly !== m.assembly || m.base > f.base[1] + f.height + tolerances.memberHeightSlackM || m.top < f.base[1] - tolerances.memberHeightSlackM) return null;
      const rel = sub(m.pos, f._centre), along = dot(rel, f._across), plane = Math.abs(rel[0] * f._across[1] - rel[1] * f._across[0]);
      if (Math.abs(along) > f.depth / 2 + tolerances.memberEndSlackM || plane > tolerances.memberPlaneM) return null;
      return { f, score: plane + Math.max(0, Math.abs(along) - f.depth / 2) };
    }).filter(Boolean).sort((a, b) => a.score - b.score || compare(a.f.id, b.f.id));
    if (!hits.length) unclassified.push(reason(m.id, m.assembly, 'member-outside-frame', 'short rack member does not lie in a paired frame plane'));
    else if (hits[1] && Math.abs(hits[1].score - hits[0].score) < 0.005) {
      // Some CAD frames are exactly co-located but vertically shifted. In those
      // exported groups, both posts and their brace fragments have consecutive
      // manifest ids. Use that provenance only when it breaks the tie clearly.
      const ranked = hits.map(({ f }) => ({ f, gap: Math.min(...f.posts.map((id) => Math.abs(ordinal(id) - ordinal(m.id)))) }))
        .sort((a, b) => a.gap - b.gap || compare(a.f.id, b.f.id));
      if (ranked[0].gap <= 12 && ranked[1].gap - ranked[0].gap > 12) ranked[0].f.members.push(m.id);
      else unclassified.push(reason(m.id, m.assembly, 'member-ambiguous', `short rack member fits ${hits[0].f.id} and ${hits[1].f.id} equally`));
    } else hits[0].f.members.push(m.id);
  }
  const beams = [];
  for (const b of beamCandidates) {
    const length = Math.max(b.spans[0], b.spans[1]);
    const nearestDef = [...beamCatalog].sort((a, c) => Math.abs(a[1] - length) - Math.abs(c[1] - length) || compare(a[0], c[0]))[0];
    const axis = [Math.cos(b.yaw), Math.sin(b.yaw)];
    const ends = [-1, 1].map((sign) => [b.pos[0] + sign * length * axis[0] / 2, b.pos[1] + sign * length * axis[1] / 2]);
    const matches = ends.map((end) => frames.flatMap((f) => f.assembly === b.assembly ? [f._a, f._b].map((p) => ({ f, p, d: dist(end, p.pos) })) : [])
      .filter((x) => x.d <= tolerances.beamEndM).sort((a, c) => a.d - c.d || compare(a.p.id, c.p.id))[0]);
    if (matches[0] && matches[1] && matches[0].f === matches[1].f) { unclassified.push(reason(b.id, b.assembly, 'beam-same-frame', `both beam ends land on ${matches[0].f.id}`)); continue; }
    if (Math.abs(nearestDef[1] - length) > tolerances.beamLengthFitM) {
      unclassified.push(reason(b.id, b.assembly, 'panel-not-beam', `CAD horizontal span ${n3(length)} m is not a stock beam length; broad panel geometry`)); continue;
    }
    if (!matches[0] || !matches[1]) { unclassified.push(reason(b.id, b.assembly, 'beam-end-miss', `beam end misses a grouped frame post by more than ${tolerances.beamEndM} m`)); continue; }
    if (matches.some(({ f }) => Math.abs(dot(axis, f._across)) > tolerances.beamPerpendicularDot)) {
      unclassified.push(reason(b.id, b.assembly, 'beam-angle', 'beam is not perpendicular to both paired frames')); continue;
    }
    const seats = matches.map(({ f, p }) => {
      const seatHeight = (b.base + b.top) / 2 - f.base[1];
      const candidates = [];
      for (let i = 0, y = 0.3048; y < f.height - 0.0762; i++, y += 0.1524) candidates.push({ i, y });
      candidates.sort((a, c) => Math.abs(a.y - seatHeight) - Math.abs(c.y - seatHeight) || a.i - c.i);
      const nearest = candidates[0];
      const col = dot(sub(p.pos, f._centre), f._across) < 0 ? 'l' : 'r';
      const facing = sub(b.pos, f._centre);
      const face = facing[0] * -f._across[1] + facing[1] * f._across[0] < 0 ? 'back' : 'front';
      return { frame: f.id, post: p.id, col, face, height: n3(seatHeight), seatSourceDef: f.catalogDef ?? f.fit.nearest,
        nearestCatalogSeat: nearest ? `${face}-${col}-${nearest.i}` : null, offset: nearest ? n3(seatHeight - nearest.y) : null };
    });
    beams.push({ id: '', assembly: b.assembly, component: b.id, frames: matches.map((m) => m.f.id), length: n3(length), catalogDef: nearestDef[0], fit: { lengthErr: n3(length - nearestDef[1]) }, seats });
  }
  beams.sort((a, b) => compare(a.assembly, b.assembly) || compare(a.component, b.component));
  byAssemblyNumber.clear();
  for (const b of beams) {
    const next = (byAssemblyNumber.get(b.assembly) ?? 0) + 1;
    byAssemblyNumber.set(b.assembly, next);
    b.id = `beam-2026-${b.assembly}-${String(next).padStart(3, '0')}`;
  }
  unclassified.sort((a, b) => compare(a.component, b.component));
  const counts = { rackMemberComponents: sorted.filter((r) => r.kind === 'rack_member').length, sceneRackMemberComponents: sorted.filter((r) => r.kind === 'rack_member' && r.pos).length,
    beamCandidates: sorted.filter((r) => r.kind === 'beam_candidate').length, sceneBeamCandidateComponents: beamCandidates.length, frames: frames.length, beams: beams.length, unclassified: unclassified.length, byAssembly: {}, byCatalogDef: {}, byReason: {} };
  for (const assembly of [...new Set(sorted.map((r) => r.assembly))].sort(compare)) counts.byAssembly[assembly] = {
    frames: frames.filter((f) => f.assembly === assembly).length, beams: beams.filter((b) => b.assembly === assembly).length,
    unclassified: unclassified.filter((u) => u.assembly === assembly).length,
  };
  for (const f of frames) counts.byCatalogDef[f.catalogDef ?? 'unmatched-frame'] = (counts.byCatalogDef[f.catalogDef ?? 'unmatched-frame'] ?? 0) + 1;
  for (const b of beams) counts.byCatalogDef[b.catalogDef] = (counts.byCatalogDef[b.catalogDef] ?? 0) + 1;
  for (const u of unclassified) counts.byReason[u.code] = (counts.byReason[u.code] ?? 0) + 1;
  const consumed = [...frames.flatMap((f) => [...f.posts, ...f.members]), ...beams.map((b) => b.component), ...unclassified.map((u) => u.component)];
  if (consumed.length !== sorted.length || new Set(consumed).size !== sorted.length || sorted.some((r) => !consumed.includes(r.id))) throw new Error('grouping does not account for each input exactly once');
  return { schema: 'mars-2026-frames/1', source, generator: 'viewer/deploy/group-2026-frames.mjs',
    fieldSources: { heightDepthAndVerticalBounds: 'manifest instances[].cad_bounds_m',
      worldXZAndYaw: 'scene obstacles[] prisms', componentAndAssembly: 'manifest instances[].id/assembly_id',
      nearestCatalogFit: 'viewer/engine/world/catalog.ts (dimensions and 6 in seat sequence)' }, tolerances,
    frames: frames.map(({ _a, _b, _across, _centre, ...publicFrame }) => ({ ...publicFrame, members: publicFrame.members.sort(compare) })),
    beams, counts, unclassified };
}

function markdown(data, records) {
  const postHist = new Map();
  for (const r of records.filter((x) => x.kind === 'rack_member' && x.spans[2] > tolerances.postMinHeightM && Math.max(x.spans[0], x.spans[1]) <= tolerances.postMaxSectionM)) {
    const h = n3(r.spans[2]); postHist.set(h, (postHist.get(h) ?? 0) + 1);
  }
  const lines = ['# 2026 CAD rack grouping: unclassified and dimensional evidence', '',
    'Generated by `viewer/deploy/group-2026-frames.mjs` from the read-only CAD manifest and scene prisms.',
    'Dimensions are evidence from CAD, not verified stock or as-built measurements. A null frame catalog definition is intentional.', '',
    `Input: ${data.counts.rackMemberComponents} manifest rack members (${data.counts.sceneRackMemberComponents} with scene prisms), ${data.counts.beamCandidates} manifest beam candidates (${data.counts.sceneBeamCandidateComponents} with scene prisms).`,
    `Grouped: ${data.counts.frames} frames, ${data.counts.beams} beams. Unclassified: ${data.counts.unclassified}.`, '',
    '## By assembly', '', '| Assembly | Frames | Beams | Unclassified |', '| --- | ---: | ---: | ---: |'];
  for (const [k, v] of Object.entries(data.counts.byAssembly)) lines.push(`| ${k} | ${v.frames} | ${v.beams} | ${v.unclassified} |`);
  lines.push('', '## Unclassified reasons', '', '| Reason code | Count |', '| --- | ---: |');
  for (const [k, v] of Object.entries(data.counts.byReason).sort((a, b) => b[1] - a[1] || compare(a[0], b[0]))) lines.push(`| ${k} | ${v} |`);
  lines.push('', '## Reasons by assembly', '', '| Assembly | Reason | Count |', '| --- | --- | ---: |');
  for (const assembly of Object.keys(data.counts.byAssembly)) {
    const reasons = new Map();
    for (const u of data.unclassified.filter((u) => u.assembly === assembly)) reasons.set(u.code, (reasons.get(u.code) ?? 0) + 1);
    for (const [code, count] of [...reasons].sort((a, b) => b[1] - a[1] || compare(a[0], b[0]))) lines.push(`| ${assembly} | ${code} | ${count} |`);
  }
  lines.push('', '## Tall post height histogram', '', '| CAD height (m, mm-rounded) | Posts | Catalog interpretation |', '| ---: | ---: | --- |');
  for (const [h, count] of [...postHist].sort((a, b) => a[0] - b[0])) {
    const best = [...frameCatalog].sort((a, b) => Math.abs(a[1] - h) - Math.abs(b[1] - h))[0];
    const fit = Math.abs(best[1] - h) <= tolerances.frameHeightFitM ? `${best[0]} height only; depth must also fit` : `no height match (nearest ${best[0]}, ${(h - best[1]).toFixed(3)} m)`;
    lines.push(`| ${h.toFixed(3)} | ${count} | ${fit} |`);
  }
  const panels = data.unclassified.filter((u) => u.code === 'panel-not-beam');
  lines.push('', '## Beam candidates that are panels', '', `${panels.length} candidates have broad 2.94 × 2.26 m or 1.2–1.61 × 3.3–3.5 m CAD spans, outside the catalog beam lengths. Examples: ${panels.slice(0, 12).map((x) => x.component).join(', ')}.`,
    '', '## 9 ft question', '', 'The tall-post histogram has no 2.743 m post. The beam candidate lengths have no catalog 9 ft match. This CAD source offers no evidence to resolve whether Gene meant a 9 ft frame or beam.',
    '', '## Beam seat evidence', '', 'Each grouped beam end records its CAD beam-centre height relative to its frame base, the nearest stock catalog seat at a 6 in pitch, and a signed offset. These offsets are not snapped. The 2022 Kit levels are a separate source.');
  const seatHeights = new Map();
  for (const b of data.beams) for (const s of b.seats) seatHeights.set(s.height, (seatHeights.get(s.height) ?? 0) + 1);
  lines.push('', '| CAD beam centre above frame base (m) | Ends | Nearest stock-seat offset (m) |', '| ---: | ---: | ---: |');
  for (const [height, count] of [...seatHeights].sort((a, b) => a[0] - b[0])) {
    const s = data.beams.flatMap((b) => b.seats).find((s) => s.height === height);
    lines.push(`| ${height.toFixed(3)} | ${count} | ${s.offset.toFixed(3)} |`);
  }
  lines.push(
    '', '## Ten hard cases', '');
  const priority = ['coincident-post', 'post-height-mismatch', 'lone-post', 'member-ambiguous', 'beam-end-miss', 'beam-same-frame', 'no-scene-prism', 'member-outside-frame', 'panel-not-beam'];
  const hard = [...data.unclassified].sort((a, b) => priority.indexOf(a.code) - priority.indexOf(b.code) || compare(a.component, b.component)).slice(0, 10);
  for (const u of hard) lines.push(`- **${u.component}** (${u.assembly}, ${u.code}): ${u.reason}.`);
  lines.push('', '## Source and classification limits', '',
    'CAD bounds in the manifest provide height and horizontal span. Scene prisms provide world-space x/z and yaw. Seven manifest members have no scene prism; they remain unclassified. Near-coincident posts are kept separate and named in the unclassified list. Frame pairing is geometric at the measured ~1.02 m separation; no historical identity is inferred.', '');
  return lines.join('\n');
}

function svg(data, records, scene) {
  const colors = { 'upright-8ft': '#4477aa', 'upright-9ft': '#44aa99', 'upright-12ft': '#117733', 'upright-16ft': '#66aa33', 'upright-19ft': '#8833aa', null: '#7957a5' };
  const assemblies = Object.keys(data.counts.byAssembly).filter((a) => data.counts.byAssembly[a].frames || data.counts.byAssembly[a].beams);
  const panelW = 540, panelH = 560, scale = 13; // 13 SVG px per metre
  const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${panelW * assemblies.length}" height="${panelH}" viewBox="0 0 ${panelW * assemblies.length} ${panelH}">`,
    `<rect width="100%" height="100%" fill="#fafaf7"/>`];
  assemblies.forEach((assembly, idx) => {
    const rs = records.filter((r) => r.assembly === assembly && r.pos);
    const minX = Math.min(...rs.map((r) => r.pos[0])), maxX = Math.max(...rs.map((r) => r.pos[0]));
    const minZ = Math.min(...rs.map((r) => r.pos[1])), maxZ = Math.max(...rs.map((r) => r.pos[1]));
    const localScale = Math.min(scale, 470 / Math.max(maxX - minX, maxZ - minZ, 1));
    const x = (v) => 35 + (v - minX) * localScale;
    const y = (v) => 65 + (maxZ - v) * localScale;
    parts.push(`<g transform="translate(${idx * panelW},0)" font-family="Arial" font-size="11" fill="#263037"><rect x="1" y="1" width="${panelW - 2}" height="${panelH - 2}" fill="none" stroke="#ccd4d6"/>`,
      `<text x="24" y="30" font-size="17" font-weight="bold">${esc(assembly)}</text><text x="24" y="47">Scale: ${localScale.toFixed(2)} px/m · +z up</text>`);
    const context = scene.obstacles.filter((row) => row[11] === assembly && row[2] >= minX - 3 && row[2] <= maxX + 3 && row[3] >= minZ - 3 && row[3] <= maxZ + 3);
    for (const row of context) {
      const w = Math.max(1, row[4] * 2 * localScale), h = Math.max(1, row[5] * 2 * localScale);
      parts.push(`<rect x="${(x(row[2]) - w / 2).toFixed(2)}" y="${(y(row[3]) - h / 2).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="#bbc5c5" opacity=".10" transform="rotate(${(-row[6] * 180 / Math.PI).toFixed(2)} ${x(row[2]).toFixed(2)} ${y(row[3]).toFixed(2)})"/>`);
    }
    for (const r of rs) {
      const w = Math.max(1.2, r.half == null ? 2 : r.half[0] * 2 * localScale);
      const h = Math.max(1.2, r.half == null ? 2 : r.half[1] * 2 * localScale);
      parts.push(`<rect x="${(x(r.pos[0]) - w / 2).toFixed(2)}" y="${(y(r.pos[1]) - h / 2).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="#b8c1c1" opacity=".48" transform="rotate(${(-r.yaw * 180 / Math.PI).toFixed(2)} ${x(r.pos[0]).toFixed(2)} ${y(r.pos[1]).toFixed(2)})"/>`);
    }
    for (const f of data.frames.filter((f) => f.assembly === assembly)) {
      const a = rs.find((r) => r.id === f.posts[0]), b = rs.find((r) => r.id === f.posts[1]);
      parts.push(`<line x1="${x(a.pos[0])}" y1="${y(a.pos[1])}" x2="${x(b.pos[0])}" y2="${y(b.pos[1])}" stroke="${colors[f.catalogDef]}" stroke-width="4"/>`,
        `<text x="${x(f.base[0]) + 3}" y="${y(f.base[2]) - 3}" font-size="9">${esc(f.id.split('-').at(-1))}</text>`);
    }
    for (const b of data.beams.filter((b) => b.assembly === assembly)) {
      const a = rs.find((r) => r.id === b.component), d = [Math.cos(a.yaw), Math.sin(a.yaw)];
      parts.push(`<line x1="${x(a.pos[0] - d[0] * b.length / 2)}" y1="${y(a.pos[1] - d[1] * b.length / 2)}" x2="${x(a.pos[0] + d[0] * b.length / 2)}" y2="${y(a.pos[1] + d[1] * b.length / 2)}" stroke="#ea741d" stroke-width="2.5"/>`);
    }
    const un = new Set(data.unclassified.map((u) => u.component));
    for (const r of rs.filter((r) => un.has(r.id))) parts.push(`<circle cx="${x(r.pos[0])}" cy="${y(r.pos[1])}" r="2.3" fill="#d33232"/>`);
    parts.push(`<text x="24" y="${panelH - 26}">grey prisms · purple unmatched frames · orange beams · red unclassified</text></g>`);
  });
  parts.push('</svg>\n');
  return parts.join('');
}

export function derive(scene, manifest) {
  const records = sourceRecords(scene, manifest);
  const data = groupRecords(records, { scene: 'viewer/public/engine/campus-2026.json', sceneContentHash: scene.contentHash, manifest: 'viewer/public/modular/components.json' });
  return { data, report: markdown(data, records), overlay: svg(data, records, scene) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const scene = JSON.parse(readFileSync(scenePath, 'utf8'));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const { data, report, overlay } = derive(scene, manifest);
  const files = [[outputPath, JSON.stringify(data, null, 2) + '\n'], [reportPath, report], [svgPath, overlay]];
  if (check) {
    for (const [p, expected] of files) if (readFileSync(p, 'utf8') !== expected) throw new Error(`generated output differs: ${p}`);
    console.log('2026 frame grouping outputs are byte-identical');
  } else {
    for (const [p, contents] of files) writeFileSync(p, contents);
    console.log(JSON.stringify(data.counts));
  }
}
