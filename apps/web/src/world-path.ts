const match = location.pathname.match(/^\/w\/(toy|mars|littlemartians|eden)(?:\/|$)/);
export const worldKey = match?.[1] ?? 'toy';
export const worldPath = `/w/${worldKey}`;
export const apiPath = (path: string) => worldPath + path;
