import type {Hono} from 'hono';
import {EDGE_CONTRACT,EdgeError,edgeBody,type EdgeDeps,edgeErrorOf} from '../contract.ts';
import type {EdgeLedger} from '../ledger/ledger.ts';
import {EDEN_LIBRARY_CATALOGUE,EDEN_CONTENT_VERSION} from '../content/eden-library-catalogue.ts';
/** Curated catalogue metadata is public; produced records require their owning Soul token. */
export function mountOutcomeRoutes(app:Hono,deps:EdgeDeps&{ledger:EdgeLedger}){
 app.get('/v1/edge/content/catalogue',c=>{c.header('Cache-Control','public, max-age=60');return c.json(edgeBody({apiContract:'eden-edge/1.1',contentVersion:EDEN_CONTENT_VERSION,books:EDEN_LIBRARY_CATALOGUE.map(b=>({id:b.id,title:b.title,author:b.author,passages:b.passages.length,tags:b.tags,about:b.about,provenance:b.provenance}))}));});
 app.get('/v1/edge/content/objects/:id',c=>{c.header('Cache-Control','no-store');try{const soul=deps.soul(c),object=deps.ledger.outcomes.artifact(soul.soulId,c.req.param('id'));return object?c.json(edgeBody({apiContract:'eden-edge/1.1',object})):c.json({contract:EDGE_CONTRACT,error:{code:'not-found',message:'No such record for this Soul.'}},404);}catch(e){return c.json({contract:EDGE_CONTRACT,error:e instanceof EdgeError&&e.status===401?edgeErrorOf(e):{code:'unauthorized',message:'Pair a Soul before reading its records.'}},401);}});
 app.get('/v1/edge/mail',c=>{c.header('Cache-Control','no-store');try{const soul=deps.soul(c);return c.json(edgeBody({apiContract:'eden-edge/1.1',letters:deps.ledger.outcomes.mailbox(soul.soulId)}));}catch{return c.json({contract:EDGE_CONTRACT,error:{code:'unauthorized',message:'Pair a Soul before reading its postbox.'}},401);}});
 app.get('/v1/edge/mail/:id',c=>{c.header('Cache-Control','no-store');try{const soul=deps.soul(c),letter=deps.ledger.outcomes.mail(soul.soulId,c.req.param('id'));return letter?c.json(edgeBody({apiContract:'eden-edge/1.1',letter})):c.json({contract:EDGE_CONTRACT,error:{code:'not-found',message:'No such letter for this Soul.'}},404);}catch{return c.json({contract:EDGE_CONTRACT,error:{code:'unauthorized',message:'Pair a Soul before reading its postbox.'}},401);}});
}
