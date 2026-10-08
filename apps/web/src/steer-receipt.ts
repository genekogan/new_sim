/** Human projection of the CURRENT G responses; not a new producer contract.
 * A command/mandate receipt records acceptance, never action completion.
 */
export type SteerReceipt = {
  kind: 'accepted' | 'refused' | 'unconfirmed';
  title: string;
  detail: string;
  seq?: number;
  tick?: number;
};

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
const words = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;
const index = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

export function steerReceipt(status: number, body: unknown, endpoint: 'command' | 'mandate' | 'intent'): SteerReceipt {
  const data = record(body);
  if (status === 0 || status >= 500 || (status >= 200 && status < 300 && status !== 200)) return {
    kind: 'unconfirmed', title: 'Direction could not be confirmed',
    detail: 'The server may have saved your direction. Check your Soul’s history before sending it again.',
  };
  if (status !== 200) return {
    kind: 'refused', title: 'Direction was not accepted',
    detail: words(data.message) ?? `The server answered ${status}.`,
  };
  if (data.ok === false) return {
    kind: 'refused', title: 'Could not understand this direction',
    detail: words(data.reason) ?? 'Try describing the action another way.',
  };
  // The exact-intent HTTP route returns the same top-level ok/text/seq/tick
  // envelope, plus its accepted intent. The internal Souls method's event
  // wrapper is not the wire response.
  const understood = words(data.text);
  const accepted = endpoint === 'intent'
    ? data.ok === true && Object.keys(record(data.intent)).length > 0 && index(data.seq) !== undefined
    : data.ok === true;
  if (!accepted || !understood) return {
    kind: 'unconfirmed', title: 'Direction could not be confirmed',
    detail: 'The response was incomplete. Check your Soul’s history before sending it again.',
  };
  return {
    kind: 'accepted', title: endpoint === 'mandate' ? 'Rule accepted' : 'Direction accepted',
    detail: understood,
    seq: index(data.seq),
    tick: index(data.tick),
  };
}
