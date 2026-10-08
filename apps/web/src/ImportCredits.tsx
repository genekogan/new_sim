/** Thanks to the CC0 artists whose models and animations Eden uses (courtesy; CC0 needs no attribution). Full
 * provenance per file: team/asset-scouting/SOURCES.csv. Shown at the foot of the camera help card. */
export const IMPORT_CREDITS: readonly { who: string; what: string; url: string }[] = [
  { who: 'Quaternius', what: 'people and their animations (Universal Animation Library 1 & 2), animals, crops, food, boats, bikes, house fixtures, plants and trees', url: 'https://quaternius.com' },
  { who: 'Kenney', what: 'rowboats, canoe, table food and kitchenware, flowers and mushrooms', url: 'https://kenney.nl' },
];
export function ImportCredits() {
  return <details className="camera-credits">
    <summary>Credits</summary>
    <p>Eden's people, animals and many small things are CC0 (public domain) models and animations. Thank you:</p>
    <ul>{IMPORT_CREDITS.map((c) => <li key={c.who}><a href={c.url} target="_blank" rel="noreferrer noopener">{c.who}</a> — {c.what}</li>)}</ul>
  </details>;
}
