import { BASE } from './base-path.ts';
import { worldKeyFrom } from './snapshot-prefetch.ts';
export const worldKey = worldKeyFrom(location.pathname, BASE);  // the same function index.html's entry prefetch runs
export const worldPath = `${BASE}/w/${worldKey}`;
export const apiPath = (path: string) => worldPath + path;
