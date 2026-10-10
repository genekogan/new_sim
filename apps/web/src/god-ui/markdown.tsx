// A tiny markdown renderer for the god panel's authored texts (the welcome,
// template notes). Enough of CommonMark for what the server writes: ATX
// headings, paragraphs, bullet and numbered lists, fenced code (with a copy
// button), inline code, bold, italic, links. Never injects HTML.
import { useState, type ReactNode } from 'react';
import { commandText, parseMarkdown } from './md-parse.ts';

/** Inline spans: `code`, **bold**, *italic* / _italic_, [text](url). */
export function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`+)([^`]+?)\1|\*\*([^*]+)\*\*|\*([^*\s][^*]*?)\*|(?<![\w])_([^_]+)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let at = 0, m: RegExpExecArray | null, n = 0;
  while ((m = re.exec(text))) {
    if (m.index > at) out.push(text.slice(at, m.index));
    const k = `${key}.${n++}`;
    if (m[2] !== undefined) out.push(<code key={k}>{m[2]}</code>);
    else if (m[3] !== undefined) out.push(<b key={k}>{inline(m[3], k)}</b>);
    else if (m[4] !== undefined) out.push(<i key={k}>{inline(m[4], k)}</i>);
    else if (m[5] !== undefined) out.push(<i key={k}>{inline(m[5], k)}</i>);
    else if (m[6] !== undefined) { const href = /^(https?:|\/|#|\.)/.test(m[7]) ? m[7] : '#'; out.push(<a key={k} href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{inline(m[6], k)}</a>); }
    at = re.lastIndex;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

export function CopyButton({ text, label = 'copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); }
    catch {  // clipboard API refused (http, headless): fall back to a selection copy
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* nothing more to try */ } ta.remove();
    }
    setDone(true); setTimeout(() => setDone(false), 1400);
  };
  return <button type="button" className="gp-copy" data-copy={text.slice(0, 40)} onClick={copy} title="Copy to the clipboard">{done ? 'copied' : label}</button>;
}

export function Markdown({ source, skipFirstHeading = false }: { source: string; skipFirstHeading?: boolean }) {
  let blocks = parseMarkdown(source);
  if (skipFirstHeading && blocks[0]?.kind === 'h') blocks = blocks.slice(1);
  return (
    <div className="gp-md">
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.kind) {
          case 'h': { const H = (`h${Math.min(6, b.level + 2)}`) as 'h3'; return <H key={k}>{inline(b.text, k)}</H>; }
          case 'p': return <p key={k}>{inline(b.text, k)}</p>;
          case 'ul': return <ul key={k}>{b.items.map((t, j) => <li key={j}>{inline(t, `${k}.${j}`)}</li>)}</ul>;
          case 'ol': return <ol key={k}>{b.items.map((t, j) => <li key={j}>{inline(t, `${k}.${j}`)}</li>)}</ol>;
          case 'hr': return <hr key={k} />;
          case 'code': return <div key={k} className="gp-code"><div className="gp-code-bar"><span>{b.lang || 'shell'}</span><CopyButton text={commandText(b.text)} /></div><pre><code>{b.text}</code></pre></div>;
        }
      })}
    </div>
  );
}
