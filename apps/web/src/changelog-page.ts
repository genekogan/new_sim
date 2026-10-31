// The public changelog page (<base>/changelog, issue #388): CHANGELOG.md rendered to static HTML when the web app is
// built (vite.config.ts `changelogPage`, into changelog.html), so the page ships with its release, loads no script and
// asks nothing of GitHub or the API at runtime. CHANGELOG.md is what tools/changelog/compile.mjs writes:
//   ## <version> (<YYYY-MM-DD>)    a release; any other `## ` heading (## Earlier) is a closing note
//   ### Features | Fixes | …        a group inside a release
//   - one line                       an entry (indented lines continue it); other lines are paragraphs
// Plain text only: entry text is escaped, and only `code` spans become markup.

export type ChangelogBlock = { kind: 'group'; title: string; items: string[] } | { kind: 'text'; text: string };
export type ChangelogRelease = { version: string; date: string; blocks: ChangelogBlock[] };
export type ChangelogNote = { title: string; text: string[] };
export type Changelog = { releases: ChangelogRelease[]; notes: ChangelogNote[] };

const RELEASE = /^## +(\S+) +\((\d{4}-\d{2}-\d{2})\) *$/;

/** Parses CHANGELOG.md; throws when it names no release, so a broken file fails the build instead of an empty page. */
export function parseChangelog(md: string): Changelog {
  const releases: ChangelogRelease[] = [], notes: ChangelogNote[] = [];
  let release: ChangelogRelease | null = null, note: ChangelogNote | null = null, item: { items: string[] } | null = null;
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('## ')) {
      const m = RELEASE.exec(line);
      item = null;
      if (m) { release = { version: m[1]!, date: m[2]!, blocks: [] }; releases.push(release); note = null; }
      else { note = { title: line.slice(3).trim(), text: [] }; notes.push(note); release = null; }
      continue;
    }
    if (!release && !note) continue;   // the file's own title and intro: the page has its own
    if (note) { if (line.trim()) note.text.push(line.trim()); continue; }
    if (line.startsWith('### ')) { const g = { kind: 'group' as const, title: line.slice(4).trim(), items: [] }; release!.blocks.push(g); item = g; continue; }
    const bullet = /^[-*] +(.*)$/.exec(line);
    if (bullet) {
      if (!item) { const g = { kind: 'group' as const, title: '', items: [] }; release!.blocks.push(g); item = g; }
      item.items.push(bullet[1]!.trim());
      continue;
    }
    if (!line.trim()) continue;
    if (item && /^\s+\S/.test(raw) && item.items.length) { item.items[item.items.length - 1] += ' ' + line.trim(); continue; }
    item = null;
    release!.blocks.push({ kind: 'text', text: line.trim() });
  }
  if (!releases.length) throw Error('CHANGELOG.md: no release headings ("## <version> (<YYYY-MM-DD>)"), so the changelog page would be empty');
  return { releases, notes };
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);

/** Escaped text with `code` spans as <code>. */
export function inline(text: string): string {
  return text.split(/(`[^`]+`)/).map((part) => (/^`[^`]+`$/.test(part) ? `<code>${escapeHtml(part.slice(1, -1))}</code>` : escapeHtml(part))).join('');
}

/** A release's anchor: `v4.0`, `v3.62` (stable, so a visitor can link one release). */
export const releaseId = (version: string) => 'v' + version.replace(/[^A-Za-z0-9._-]/g, '-');

const LONG_DATE = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
const longDate = (iso: string) => { const t = Date.parse(iso + 'T00:00:00Z'); return Number.isNaN(t) ? iso : LONG_DATE.format(t); };

/** The page's body content (inside <main>): releases newest first, as CHANGELOG.md lists them. */
export function renderChangelog(log: Changelog, { home }: { home: string }): string {
  const out: string[] = [];
  out.push(`<nav class="cl-nav"><a href="${escapeHtml(home)}">← Worlds</a></nav>`);
  out.push('<header class="cl-head"><h1>Changelog</h1><p>What changed in Sim, release by release. Newest first.</p></header>');
  for (const r of log.releases) {
    const id = releaseId(r.version);
    out.push(`<section class="cl-release" id="${escapeHtml(id)}" aria-labelledby="${escapeHtml(id)}-h">`);
    out.push(`<h2 id="${escapeHtml(id)}-h"><a class="cl-v" href="#${escapeHtml(id)}">${escapeHtml(r.version)}</a> <time datetime="${escapeHtml(r.date)}">${escapeHtml(longDate(r.date))}</time></h2>`);
    out.push('<div class="cl-body">');
    for (const b of r.blocks) {
      if (b.kind === 'text') { out.push(`<p class="cl-note">${inline(b.text)}</p>`); continue; }
      if (b.title) out.push(`<h3>${escapeHtml(b.title)}</h3>`);
      out.push(`<ul>${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`);
    }
    out.push('</div></section>');
  }
  for (const n of log.notes) out.push(`<section class="cl-release cl-end"><h2>${escapeHtml(n.title)}</h2><div class="cl-body">${n.text.map((t) => `<p class="cl-note">${inline(t)}</p>`).join('')}</div></section>`);
  return out.join('\n');
}

/** Fills changelog.html's `<!--changelog-->` slot; `base` is Vite's (`/` or `/worlds/`), so "Worlds" goes to this build's list. */
export function changelogHtml(template: string, md: string, base: string): string {
  if (!template.includes('<!--changelog-->')) throw Error('changelog.html: no <!--changelog--> slot');
  const home = base.endsWith('/') ? base : base + '/';
  return template.replace('<!--changelog-->', () => renderChangelog(parseChangelog(md), { home }));
}
