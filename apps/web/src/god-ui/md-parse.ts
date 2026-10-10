// Markdown → blocks for the god panel (pure; tested by md-parse.test.ts).

export type Block =
  | { kind: 'h'; level: number; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'hr' };

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push({ kind: 'p', text: para.join(' ').trim() }); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*(```|~~~)\s*([\w-]*)\s*$/);
    if (fence) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) body.push(lines[i]);
      out.push({ kind: 'code', lang: fence[2], text: body.join('\n') });
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) { flush(); out.push({ kind: 'h', level: h[1].length, text: h[2] }); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push({ kind: 'hr' }); continue; }
    const li = line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/);
    if (li) {
      flush();
      const kind = li[1] ? 'ul' : 'ol';
      const last = out[out.length - 1];
      const list = last && last.kind === kind ? last : (out.push({ kind, items: [] }), out[out.length - 1] as { kind: 'ul' | 'ol'; items: string[] });
      list.items.push(li[3]);
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    // a continuation line of the last list item (indented) joins it
    const last = out[out.length - 1];
    if (!para.length && last && (last.kind === 'ul' || last.kind === 'ol') && /^\s{2,}\S/.test(line)) { last.items[last.items.length - 1] += ' ' + line.trim(); continue; }
    para.push(line);
  }
  flush();
  return out;
}

/** What a person wants on the clipboard from a shell block: the commands, without trailing `# comments`. */
export function commandText(block: string) {
  return block.split('\n').map((l) => l.replace(/\s+#\s.*$/, '').replace(/\s+$/, '')).filter((l) => l.length).join('\n');
}
