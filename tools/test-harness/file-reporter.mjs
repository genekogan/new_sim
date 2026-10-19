// Node's TAP omits source paths on passing assertions. Preserve independent
// leaf attribution so a previously unloadable file cannot disappear silently.
export default async function* fileReporter(events) {
  for await (const event of events) {
    if (['test:pass', 'test:fail'].includes(event.type)) {
      const { file, name, details } = event.data;
      if (file) yield JSON.stringify({event:event.type,file,name,type:details?.type,skip:event.data.skip??false,todo:event.data.todo??false,nesting:event.data.nesting,ms:details?.duration_ms})+'\n';
    }
    if (event.type === 'test:summary') yield JSON.stringify({event:event.type,counts:event.data.counts})+'\n';
  }
}
