// The page's asset transport, installed once by whichever entry runs first (main.tsx, or P7b's early-entry.ts): the CDN
// transport, then the arrival bar's byte meter around it (it meters the original asset URL, including its CDN attempt and
// origin fallback). A large CDN file is buffered for its hash check: its bytes reach the arrival bar while they stream in.
import { installCdnAssets } from './cdn-assets.ts';
import { assetBytes, installAssetMeter } from './asset-bytes.ts';
import cdnManifestUrl from './cdn-manifest.json?url';

let installed = false;
export function installAssetTransport(): void {
  if (installed) return;
  installed = true;
  installCdnAssets(cdnManifestUrl, (url, loaded) => assetBytes.progress(url, loaded));
  installAssetMeter();
}
