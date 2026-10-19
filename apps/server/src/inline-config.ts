// Lane W1 (tranche 2026-10-19): the world page carries its own /v1/config. On live Eden 2026 the page's app waited for
// that GET (one round trip to Germany, and behind the 156 KB snapshot on the same connection: ~0.5 s of a warm arrival)
// before it mounted at all. The page HTML is never cached (no-cache) and the config is public, so the server writes
// the same JSON the route answers into <head>; the page uses it and skips the GET.
/** The window property the world page's HTML sets (apps/web/src/main.tsx reads it). */
export const INLINE_CONFIG_GLOBAL = '__simConfig';

/** JSON safe inside an inline <script>: `<` (no `</script>` or `<!--`), U+2028 and U+2029 escaped. publicUrl comes from
 *  the request's forwarded host, so this is what keeps a hostile Host header out of the page's markup. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** The world page's HTML with its config set first thing in <head> (before any script that reads it). */
export function withInlineConfig(html: string, config: unknown): string {
  if (config === null || typeof config !== 'object') return html;
  const at = html.search(/<head[^>]*>/i);
  if (at < 0) return html;
  const end = html.indexOf('>', at) + 1;
  return html.slice(0, end) + `<script>window.${INLINE_CONFIG_GLOBAL}=${scriptJson(config)}</script>` + html.slice(end);
}
