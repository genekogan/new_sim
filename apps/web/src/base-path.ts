// The path prefix this app is served under: '' at the root (the default build), or e.g. '/worlds' when the world
// launcher runs with --base /worlds beside another release on the same origin (web built with
// `vite build --base /worlds/`). Root-absolute launcher and world URLs go through it, so nothing of ours lands on the
// other release's /, /assets, /__sim, /v1 or /w/<its worlds>.
// Outside Vite (node tests that bundle the client with esbuild) import.meta.env is absent: the root build ('').
const viteBase = (() => { try { return import.meta.env.BASE_URL as string | undefined; } catch { return undefined; } })();
export const BASE = (viteBase ?? '/').replace(/\/+$/, '');
