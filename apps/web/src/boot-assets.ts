// The page's asset transport, installed once by whichever entry runs first (main.tsx, or P7b's early-entry.ts): the CDN
// transport, then the arrival bar's byte meter around it (it meters the original asset URL, including its CDN attempt and
// origin fallback). A large CDN file is buffered for its hash check: its bytes reach the arrival bar while they stream in.
import { installCdnAssets, startCdnManifest } from './cdn-assets.ts';
import { assetBytes, installAssetMeter } from './asset-bytes.ts';
import cdnManifestUrl from './cdn-manifest.json?url';

let installed = false;
/** `lazy` (t4-phone, the phone's early entry): the CDN manifest waits for the first asset fetch or a later plain call
 *  (main.tsx's, or the early renderer's fill), so the arrival poster's link does not carry it. */
export function installAssetTransport(lazy = false): void {
  if (installed) { if (!lazy) startCdnManifest(); return; }
  installed = true;
  installCdnAssets(cdnManifestUrl, (url, loaded) => assetBytes.progress(url, loaded), lazy);
  installAssetMeter();
}
