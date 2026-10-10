// The path prefix this app is served under: '' at the root (the default build), or e.g. '/worlds' when the world
// launcher runs with --base /worlds beside another release on the same origin (web built with
// `vite build --base /worlds/`). Root-absolute launcher and world URLs go through it, so nothing of ours lands on the
// other release's /, /assets, /__sim, /v1 or /w/<its worlds>.
export const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/+$/, '');
