// JSON, binary and SSE transports share one bounded per-process receipt notice.
const noticed = new Set();
export function noticeOwnerInbox(data) {
  const message = data?.inbox?.latest;
  if (!message || typeof message.id !== 'string' || !message.id || typeof message.text !== 'string' || !['sent', 'delivered'].includes(message.state) || noticed.has(message.id)) return false;
  console.error('OWNER MESSAGE ' + JSON.stringify(message));
  noticed.add(message.id);
  if (noticed.size > 256) noticed.delete(noticed.values().next().value);
  return true;
}
export function noticeInboxHeader(headers) {
  try {
    const encoded = headers?.get?.('x-sim-agent-inbox');
    if (typeof encoded !== 'string' || encoded.length > 16384 || !/^[A-Za-z0-9_-]+$/.test(encoded)) return false;
    return noticeOwnerInbox(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(encoded, 'base64url'))));
  } catch { return false; }
}
