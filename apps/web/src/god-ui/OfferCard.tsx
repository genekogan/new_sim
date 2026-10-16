// The two links the launcher's handoff (tools/world-launcher/handoff.mjs) sends people to on a world page:
//   #worldoffer/<code>   an owner's invitation: become a co-builder, or take the world over. Accepting, signed in, is the consent.
//   #cobuildpair/<code>  a co-builder's own agent asks for a god token on this world; the co-builder approves it.
import { useEffect, useState } from 'react';
import { BASE } from '../base-path.ts';
import { worldKey } from '../world-path.ts';
import { userAuthHeaders } from '../auth-session.ts';

export type OfferLink = { kind: 'worldoffer' | 'cobuildpair'; code: string };
export const offerFromHash = (hash: string): OfferLink | null => {
  const m = /^#(worldoffer|cobuildpair)\/([A-Za-z0-9_-]{4,64})$/.exec(hash);
  return m ? { kind: m[1] as OfferLink['kind'], code: m[2] } : null;
};
const at = (sub: string) => `${BASE}/__sim/worlds/${worldKey}/${sub}`;
async function send(sub: string, body: unknown) {
  const r = await fetch(at(sub), { method: 'POST', headers: { 'content-type': 'application/json', ...(await userAuthHeaders()) }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.message ?? d.code ?? `HTTP ${r.status}`);
  return d;
}

export function OfferCard({ link, signedIn, onDone }: { link: OfferLink; signedIn: boolean; onDone: () => void }) {
  const [offer, setOffer] = useState<{ kind: 'cobuild' | 'transfer'; world: { name: string } } | 'gone' | null>(null);
  const [state, setState] = useState<{ busy?: boolean; done?: string; err?: string }>({});
  useEffect(() => {
    if (link.kind !== 'worldoffer') return;
    void fetch(`${at('offer')}?code=${encodeURIComponent(link.code)}`).then((r) => (r.ok ? r.json() : 'gone')).then(setOffer, () => setOffer('gone'));
  }, [link]);
  const act = async () => {
    setState({ busy: true });
    try {
      if (link.kind === 'cobuildpair') { const d = await send('cobuild/pair/approve', { code: link.code }); setState({ done: `Approved. ${d.agent} now builds here as your co-builder agent; it finishes on its own.` }); }
      else { const d = await send('offer/accept', { code: link.code }); setState({ done: d.kind === 'transfer' ? 'This world is yours now. Reload to open God mode.' : 'You are a co-builder now. Ask your agent to pair with this world as a co-builder.' }); }
    } catch (e) { setState({ err: (e as Error).message }); }
  };
  const title = link.kind === 'cobuildpair' ? 'Your agent asks to co-build this world'
    : offer === 'gone' ? 'This invitation is no longer valid'
      : offer?.kind === 'transfer' ? `You are offered ${offer.world.name}` : offer ? `You are invited to co-build ${offer.world.name}` : 'Invitation…';
  const what = link.kind === 'cobuildpair' ? 'It gets its own god token for this world, labelled with your name. The owner can revoke it.'
    : offer && offer !== 'gone' ? (offer.kind === 'transfer' ? 'Accept and you become its god: its owner hands it to you, and every agent that could edit it loses that access.' : 'Accept and your own agent can build here alongside the owner. You cannot hand the world on or archive it.') : null;
  return (
    <div className="gp-pairs" data-offer={link.kind} data-offer-kind={offer && offer !== 'gone' ? offer.kind : ''}>
      <b>{title}</b>
      {what && <p className="gp-dim">{what}</p>}
      {!signedIn && offer !== 'gone' && <p>Sign in first; accepting with your account is your consent.</p>}
      {signedIn && !state.done && offer !== 'gone' && (link.kind === 'cobuildpair' || offer) && (
        <div className="gp-row"><button className="gp-btn gp-primary" data-offer-accept="1" disabled={state.busy} onClick={() => void act()}>{link.kind === 'cobuildpair' ? 'Approve my agent' : 'Accept'}</button><button className="gp-btn" onClick={onDone}>Not now</button></div>
      )}
      {state.done && <p role="status" className="gp-ok">{state.done}</p>}
      {state.err && <p className="gp-bad">{state.err}</p>}
      <div className="gp-row"><span /><button className="gp-mini" onClick={onDone}>close</button></div>
    </div>
  );
}
