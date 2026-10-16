// Exact cutover policy. UNKNOWN is a closed gate, never evidence of identity.
export function verdict({ content, visual, behaviour, provenance }) {
  const pairs=visual?.pairs??[],hours=visual?.hourly??[];
  const names=new Set(pairs.map(p=>p.name));
  const measuredPairs=names.size>0&&[...names].every(name=>[1,2].every(dpr=>pairs.some(p=>p.name===name&&p.dpr===dpr&&p.status==='PASS'&&p.changedPixels===0&&p.meanAbsoluteError===0&&p.old?.state?.datetime&&p.candidate?.state?.datetime)));
  const measuredHours=hours.length===24&&new Set(hours.map(h=>h.hour)).size===24&&hours.every(h=>Number.isInteger(h.hour)&&h.hour>=0&&h.hour<24&&h.status==='PASS'&&h.old?.datetime&&h.candidate?.datetime);
  const roles=['overview','interior','time'].every(kind=>pairs.some(p=>p.kind===kind))&&new Set(pairs.filter(p=>p.kind==='interior').map(p=>p.name)).size>=2&&pairs.some(p=>p.name==='dusk')&&pairs.some(p=>p.name==='night');
  const visualComplete=measuredPairs&&measuredHours&&roles&&pairs.length===visual?.coverage?.expectedPairs&&pairs.length===visual?.coverage?.actualPairs&&!visual?.errors?.length;
  const checks = [
    { name: 'content', status: content?.status ?? 'UNKNOWN' },
    { name: 'visual', status: visual?.status ?? 'UNKNOWN' },
    { name: 'visual-coverage', status: visualComplete ? 'PASS' : 'UNKNOWN' },
    { name: 'behaviour', status: behaviour?.status ?? 'UNKNOWN' },
    { name: 'live-source-and-history', status: provenance?.liveSourceAndHistory === true ? 'PASS' : 'UNKNOWN' },
  ];
  const identical = checks.every(c => c.status === 'PASS');
  return { verdict: identical ? 'identical' : 'not identical', mayMove: identical,
    checks, reason: identical ? 'All exact checks and source/history coverage passed.' :
      'Keep the old world: a difference or unproved requirement remains.' };
}
