const match = location.pathname.match(/^\/w\/([a-z][a-z0-9-]{0,31})(?:\/|$)/);
export const worldKey = match?.[1] ?? 'toy';
export const worldPath = `/w/${worldKey}`;
export const apiPath = (path: string) => worldPath + path;
