// Advisory writing diagnostics. Schema, binding and physical checks remain authoritative.
const normalized = text => String(text ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const internalRef = /\b(?:core|region|place)-[a-z0-9][a-z0-9_-]*\b|\be_[a-f0-9]{8,}\b/i;
export function lintMeaning(ref, about) {
  const diagnostics = [];
  const warn = (field, code, message, suggestion) => diagnostics.push({ ref, field, code, severity: 'warning', message, suggestion });
  const prose = (block, prefix, titleRequired) => {
    const field = name => prefix ? `${prefix}.${name}` : name;
    if (titleRequired && !normalized(block.title))
      warn(field('title'), 'meaning.title.missing', 'No visitor-facing name.', 'Name the destination in ordinary language; leave incidental scenery undescribed if it needs no identity.');
    if (block.title && internalRef.test(block.title))
      warn(field('title'), 'meaning.title.internal-ref', 'The title contains an internal-looking build reference.', 'Keep the stable ref in the binding; use the established public name in the title.');
    if (block.what && normalized(block.what) === normalized(block.title))
      warn(field('what'), 'meaning.purpose.repeats-title', 'Purpose repeats the title without adding information.', 'Say what this place is for, or one grounded relation or constraint that distinguishes it.');
    if (block.what && (internalRef.test(block.what) || /helps identify this|use only the actions/i.test(block.what)))
      warn(field('what'), 'meaning.purpose.internal-prose', 'Purpose contains internal references or agent boilerplate.', 'Replace implementation instructions with supported use, useful relations and actual constraints.');
    const seen = new Set();
    for (const [i, alias] of (block.aliases ?? []).entries()) {
      const key = normalized(alias);
      if (seen.has(key)) warn(field(`aliases[${i}]`), 'meaning.alias.duplicate', 'Alias repeats another alias after punctuation/case normalization.', 'Keep one spelling; use the space for a distinct phrase an owner would naturally say.');
      seen.add(key);
    }
  };
  prose(about, '', true);
  for (const [i, part] of (about.parts ?? []).entries()) prose(part, `parts[${i}]`, true);
  return diagnostics;
}
