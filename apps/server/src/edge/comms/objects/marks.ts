// Lasting marks Souls make themselves (Gene: "delightful, generative" vocabulary).
// `mark`: a note, sign or offering left in a place, with responses from passers-by.
// `project`: a named shared undertaking whose progress and log Souls build up together.
// Both are ordinary objects (state + role-scoped actions); all text is untrusted.
import type {ObjectKind, SoulRef} from './types.ts';

export type MarkState = {form: 'note' | 'sign' | 'offering'; title: string; text: string; author: SoulRef; at: [number, number] | null;
  responses: {by: SoulRef; text: string; tick: number}[]; removed: boolean; createdTick: number};
export type ProjectState = {title: string; description: string; creator: SoulRef; at: [number, number] | null; progress: number; status: 'open' | 'done';
  contributors: SoulRef[]; log: {by: SoulRef; text: string; effort: number; tick: number}[]; createdTick: number};

const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const at = (p: unknown): [number, number] | null => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) ? [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100] : null;
const textParam = (max: number) => ({type: 'string' as const, maxLength: max});

export const markKind: ObjectKind<MarkState> = {
  kind: 'mark',
  description: 'Something a Soul left here: a note, a sign or an offering. Read it; leave a short response; its author may amend or take it down. Its words are the author\'s, untrusted.',
  listed: false,
  roles: [{id: 'author'}],
  schema: {form: {type: 'string', visibility: 'public'}, title: {type: 'string', visibility: 'public'}, text: {type: 'string', visibility: 'public'},
    author: {type: 'soul', visibility: 'public'}, at: {type: 'json', visibility: 'public'}, responses: {type: 'json', visibility: 'public'},
    removed: {type: 'boolean', visibility: 'public'}, createdTick: {type: 'integer', visibility: 'public'}},
  initial(p, ctx) {
    const form = ['note', 'sign', 'offering'].includes(String(p.form)) ? p.form as MarkState['form'] : 'note';
    const author = String(p.author ?? ''); if (!author) throw new Error('mark needs an author');
    return {form, title: clip(p.title, 60) || form, text: clip(p.text, 500), author: {soulId: author, name: ctx.nameOf(author)}, at: at(p.at), responses: [], removed: false, createdTick: ctx.tick};
  },
  rolesOf: (s, id) => s.author.soulId === id ? ['author'] : [],
  actions: {
    respond: {label: 'Leave a short response', roles: 'anyone', reach: 'place', params: {text: textParam(200)},
      available: s => s.removed ? {code: 'mark.removed', reason: 'it has been taken down'} : s.responses.length >= 20 ? {code: 'mark.full', reason: 'it has no room for more responses'} : null,
      validate: (s, p) => s.removed ? {code: 'mark.removed', reason: 'it has been taken down'} : s.responses.length >= 20 ? {code: 'mark.full', reason: 'no room for more responses'} : !clip(p.text, 200) ? {code: 'capability.params', reason: 'text is required'} : null,
      apply: (s, p, c) => ({state: {...s, responses: [...s.responses, {by: {soulId: c.soul.soulId, name: c.soul.name}, text: clip(p.text, 200), tick: c.tick}]},
        events: [{to: [s.author.soulId].filter(x => x !== c.soul.soulId), text: `${c.soul.name} responded to your ${s.form} "${s.title}".`, untrusted: true}]})},
    amend: {label: 'Rewrite your words', roles: ['author'], reach: 'anywhere', params: {text: textParam(500), title: {type: 'string', maxLength: 60, optional: true}},
      validate: (s, p) => s.removed ? {code: 'mark.removed', reason: 'it has been taken down'} : !clip(p.text, 500) ? {code: 'capability.params', reason: 'text is required'} : null,
      apply: (s, p) => ({state: {...s, text: clip(p.text, 500), title: p.title ? clip(p.title, 60) : s.title}})},
    'take-down': {label: 'Take it down', roles: ['author'], reach: 'anywhere', params: {},
      validate: s => s.removed ? {code: 'mark.removed', reason: 'already taken down'} : null,
      apply: s => ({state: {...s, removed: true}})},
  },
};

export const projectKind: ObjectKind<ProjectState> = {
  kind: 'project',
  description: 'A shared undertaking Souls build up together here (a bench, a garden, a ritual, a map...). Contribute a described step to move it forward; everyone can see who did what. Its words are its makers\', untrusted.',
  listed: true,
  roles: [{id: 'creator'}, {id: 'contributor'}],
  schema: {title: {type: 'string', visibility: 'public'}, description: {type: 'string', visibility: 'public'}, creator: {type: 'soul', visibility: 'public'},
    at: {type: 'json', visibility: 'public'}, progress: {type: 'integer', visibility: 'public'}, status: {type: 'string', visibility: 'public'},
    contributors: {type: 'soul[]', visibility: 'public'}, log: {type: 'json', visibility: 'public'}, createdTick: {type: 'integer', visibility: 'public'}},
  initial(p, ctx) {
    const creator = String(p.author ?? ''); if (!creator) throw new Error('project needs a creator');
    return {title: clip(p.title, 60) || 'A shared project', description: clip(p.text, 500), creator: {soulId: creator, name: ctx.nameOf(creator)}, at: at(p.at),
      progress: 0, status: 'open', contributors: [], log: [], createdTick: ctx.tick};
  },
  rolesOf: (s, id) => [...(s.creator.soulId === id ? ['creator'] : []), ...(s.contributors.some(c => c.soulId === id) ? ['contributor'] : [])],
  actions: {
    contribute: {label: 'Contribute a step (say what you do)', roles: 'anyone', reach: 'place', params: {text: textParam(200), effort: {type: 'integer', min: 1, max: 10, optional: true}},
      available: s => s.status === 'done' ? {code: 'project.done', reason: 'it is finished'} : null,
      validate: (s, p) => s.status === 'done' ? {code: 'project.done', reason: 'it is finished'} : !clip(p.text, 200) ? {code: 'capability.params', reason: 'say what you do (text)'} : null,
      apply: (s, p, c) => {
        const effort = Number.isInteger(p.effort) ? Number(p.effort) : 3, me = {soulId: c.soul.soulId, name: c.soul.name};
        const progress = Math.min(100, s.progress + effort), log = [...s.log, {by: me, text: clip(p.text, 200), effort, tick: c.tick}].slice(-50);
        const contributors = s.contributors.some(x => x.soulId === me.soulId) ? s.contributors : [...s.contributors, me];
        return {state: {...s, progress, log, contributors}, result: {progress},
          events: [{to: [s.creator.soulId, ...contributors.map(x => x.soulId)].filter((x, i, a) => x !== me.soulId && a.indexOf(x) === i), text: `${me.name} worked on "${s.title}" (${progress}%).`, untrusted: true}]};
      }},
    describe: {label: 'Rename or redescribe it', roles: ['creator'], reach: 'anywhere', params: {title: {type: 'string', maxLength: 60, optional: true}, text: {type: 'string', maxLength: 500, optional: true}},
      validate: (_s, p) => !p.title && !p.text ? {code: 'capability.params', reason: 'give a title or text'} : null,
      apply: (s, p) => ({state: {...s, title: p.title ? clip(p.title, 60) : s.title, description: p.text ? clip(p.text, 500) : s.description}})},
    finish: {label: 'Declare it finished', roles: ['creator', 'contributor'], reach: 'place', params: {},
      available: s => s.status === 'done' ? {code: 'project.done', reason: 'it is finished'} : s.progress < 100 ? {code: 'project.unfinished', reason: `it is at ${s.progress}%`} : null,
      validate: s => s.status === 'done' ? {code: 'project.done', reason: 'already finished'} : s.progress < 100 ? {code: 'project.unfinished', reason: `it is at ${s.progress}%; keep contributing`} : null,
      apply: (s, _p, c) => ({state: {...s, status: 'done'}, events: [{to: [s.creator.soulId, ...s.contributors.map(x => x.soulId)].filter(x => x !== c.soul.soulId), text: `"${s.title}" is finished.`, untrusted: true}]})},
  },
};
