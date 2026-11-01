import { BASE } from './base-path.ts';
const halo = new URL('./media/halo-transparent.png', import.meta.url).href;
/** Site identity: the same halo used by the favicon, with transparent surroundings. */
export function EdenMark() {
  return <a className="eden-mark" href={BASE+'/'} aria-label="Souls: all worlds" title="Souls">
    <img src={halo} width="32" height="32" alt="" aria-hidden="true" />
  </a>;
}
