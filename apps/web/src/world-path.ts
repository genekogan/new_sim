import { BASE } from './base-path.ts';
const match = (BASE && location.pathname.startsWith(BASE + '/') ? location.pathname.slice(BASE.length) : location.pathname).match(/^\/w\/([a-z][a-z0-9-]{0,31})(?:\/|$)/);
export const worldKey = match?.[1] ?? 'toy';
export const worldPath = `${BASE}/w/${worldKey}`;
export const apiPath = (path: string) => worldPath + path;
