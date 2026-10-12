// A render process completing is not a passing gate. Preserve a distinct code for item defects and infrastructure.
export function viewErrors(v, label) {
  const errors = [];
  if (!v.live || v.cover === null || v.cover === undefined) errors.push(`${label}: unqualified (no isolated drawable entity)`);
  if (v.missingAsset) errors.push(`${label}: missing asset placeholder`);
  if (v.cover !== null && v.cover !== undefined && v.cover < 0.003) errors.push(`${label}: blank (object covers ${(v.cover * 100).toFixed(2)} % of the view)`);
  else if ((v.cover === null || v.cover === undefined) && v.top > 0.97) errors.push(`${label}: blank (${Math.round(v.top * 100)} % one colour)`);
  return errors;
}
export function gateExit(report) {
  if (!report || /swiftshader|llvmpipe|software|softpipe/i.test(String(report.gpu ?? '')) || !report.gpu || !report.items?.length) return 3;
  if (report.coverage && (report.coverage.missing?.length || report.coverage.duplicate?.length || report.coverage.unexpected?.length || report.coverage.accounted !== report.coverage.requested)) return 2;
  return report.items.some((item) => !item.ok || !item.views?.length) ? 2 : 0;
}
