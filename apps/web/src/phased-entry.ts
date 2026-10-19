// P7b lever E1 (team/lanes/t4-p7.md "P7b design"): index.html loads a world page in two phases where that helps. On a
// phone's link every byte waits for the bytes before it, and the world could not start building until the last of ~1 MB
// had arrived (all of React, the Shell, the UI). Phase one is the early entry (early-entry.ts) with only the chunks the
// world's entity layer needs, beside the snapshot the head script already asked for; the layer then builds the terrain
// and the near ring while phase two (main.tsx, React, the Shell, the rest of the UI, the socket) downloads. Phase two
// starts when the snapshot is in (early-entry.ts calls window.__simPhase2), after at most PHASE2_FALLBACK_MS, or at once
// if the early entry fails to load. Pages that are not two-phase (the head script's phasedEntryWanted: desktops, old
// worlds, pictures, ?phased=0) load both at once, main first, as before.
// No imports: vite.config.ts loads this file in node.

/** The window function that starts phase two (idempotent). */
export const PHASE2_GLOBAL = '__simPhase2';
/** Phase two starts by itself this long after phase one, whatever happened to the early entry. */
export const PHASE2_FALLBACK_MS = 15_000;

export type Phase = { entry: string; preloads: readonly string[] };

/** The inline loader that replaces Vite's module script and modulepreload tags. Reads window.__simPhased (snapshot-prefetch.ts
 *  head script) and opens the deferred entry socket (window.__simOpenSocket) with phase two. */
export function phasedLoaderScript(early: Phase, main: Phase): string {
  return `(function(){var d=document,W=window,E=${JSON.stringify(early)},M=${JSON.stringify(main)},done=false,`
    + `add=function(u,entry){var l=d.createElement(entry?'script':'link');if(entry){l.type='module';l.src=u;}else{l.rel='modulepreload';l.href=u;}l.crossOrigin='';d.head.appendChild(l);return l;},`
    + `two=function(){if(done)return;done=true;M.preloads.forEach(function(u){add(u);});add(M.entry,true);try{var o=W.__simOpenSocket;if(typeof o==='function')o();}catch(e){}};`
    + `W[${JSON.stringify(PHASE2_GLOBAL)}]=two;var ph=W.__simPhased===true;if(!ph)two();`
    + `E.preloads.forEach(function(u){add(u);});add(E.entry,true).onerror=two;if(ph)setTimeout(two,${PHASE2_FALLBACK_MS});})();`;
}

const MODULE_SCRIPT = /[ \t]*<script type="module" crossorigin src="([^"]+)"><\/script>\n?/g;
const MODULE_PRELOAD = /[ \t]*<link rel="modulepreload" crossorigin href="([^"]+)">\n?/g;

/** Vite's built index.html with its module script and modulepreload tags replaced by the two-phase loader. `mainFile` /
 *  `earlyFile` are the two entry chunks' file names, `earlyImports` every chunk the early entry imports (statically, at
 *  any depth). Phase one preloads those; phase two preloads what main needs beyond them. */
export function rewritePhasedHtml(html: string, mainFile: string, earlyFile: string, earlyImports: readonly string[]): string {
  const scripts = [...html.matchAll(MODULE_SCRIPT)].map((m) => m[1]);
  if (scripts.length !== 1 || !scripts[0].endsWith(mainFile)) throw Error(`index.html: expected one module script for ${mainFile}, found ${scripts.join(', ') || 'none'}`);
  const prefix = scripts[0].slice(0, -mainFile.length);
  const early = new Set([earlyFile, ...earlyImports].map((f) => prefix + f));
  const main: Phase = { entry: scripts[0], preloads: [...html.matchAll(MODULE_PRELOAD)].map((m) => m[1]).filter((u) => !early.has(u)) };
  const loader = `    <script>${phasedLoaderScript({ entry: prefix + earlyFile, preloads: earlyImports.map((f) => prefix + f) }, main)}</script>\n`;
  return html.replace(MODULE_PRELOAD, '').replace(MODULE_SCRIPT, () => loader);
}
