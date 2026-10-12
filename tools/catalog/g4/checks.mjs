// A render process completing is not a passing gate. Preserve a distinct code for item defects and infrastructure.
export function gateExit(report) {
  if (!report || /swiftshader|llvmpipe|software|softpipe/i.test(String(report.gpu ?? '')) || !report.gpu || !report.items?.length) return 3;
  return report.items.some((item) => !item.ok || !item.views?.length) ? 2 : 0;
}
