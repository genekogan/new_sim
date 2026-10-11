/** Local persistence is distinct from both a model's factual report and world
 * execution. Body/refusal verdicts already qualified by the caller take priority. */
export function ownerReplyWithLocalResults({answer,source,results=[],localResults=[]}={}){
 const verdict=()=>({answer:results.join('; ').slice(0,600),source:'execution-verdict'});
 if(source==='execution-verdict'||typeof answer!=='string'||!answer.trim())return verdict();
 const scheduled=localResults.some(r=>r.operation==='schedule'||r.operation==='compile');
 let report=answer.trim();
 if(scheduled){
  // A local saved binding cannot establish that its future world action ran.
  const unsupported=/\b(?:schedule|routine|bindings?|commitment)\b[^.!?\n]{0,80}\b(?:ran|executed|completed|finished|happened)\b|\b(?:ran|executed|completed|finished)\b[^.!?\n]{0,80}\b(?:schedule|routine|bindings?|commitment)\b/i;
  report=report.split(/(?<=[.!?])\s+|\n+/).filter(clause=>!unsupported.test(clause)).join(' ');
 }
 const warnings=localResults.filter(r=>r.accepted===false||r.operation==='schedule'||r.operation==='compile').map(r=>r.line);
 if(scheduled)warnings.push('Saving a local schedule or binding does not confirm execution.');
 if(!report)return verdict();
 // Keep the authoritative failure visible before truncating an independent report.
 const prefix=warnings.length?warnings.join('; ')+' Model report (unverified): ':'';
 return {answer:(prefix+report).slice(0,600),source:'model-unverified'};
}
