// G8 moderation: what an upload route calls. Validate and strip, refuse what the admin already vetoed,
// classify, and (after the store has kept the bytes) log a quarantine.
import { classify, type UploadSurface, type Verdict } from './classifier.ts';
import { UploadRejected, validateUpload, type UploadPolicy, type ValidatedUpload } from './validate.ts';
import type { ModerationStore } from './store.ts';

export type Intake = { upload: ValidatedUpload; verdict: Verdict };
const ALLOW: Verdict = { action: 'allow', classifier: 'none', labels: [] };

export async function intakeUpload(store: ModerationStore, bytes: Uint8Array, opts: { surface: UploadSurface; policy: UploadPolicy; words?: (string | undefined)[]; actor: string }): Promise<Intake> {
  const upload = validateUpload(bytes, opts.policy);
  if (store.state(upload.sha).adminVeto) throw new UploadRejected(451, 'moderation.vetoed', 'This file was removed by the site admin and cannot be uploaded again');
  if (upload.format === 'json') return { upload, verdict: ALLOW };
  const text = [...opts.words ?? []].filter((w): w is string => typeof w === 'string' && !!w.trim()).map((w) => w.slice(0, 300)).concat(upload.text);
  const verdict = await classify({ surface: opts.surface, format: upload.format, sha: upload.sha, bytes: upload.bytes.length, tris: upload.tris, textures: upload.textures, texPx: upload.texPx, text, images: upload.images });
  if (verdict.action === 'reject') {
    store.append({ sha: upload.sha, action: 'reject', actor: `classifier:${verdict.classifier}`, role: 'classifier', reason: verdict.reason ?? verdict.labels.join(', '), detail: { surface: opts.surface, uploader: opts.actor, labels: verdict.labels } });
    throw new UploadRejected(422, 'moderation.rejected', 'This upload was refused by the content check');
  }
  return { upload, verdict };
}

/** After the store kept the bytes: a quarantine verdict hides the upload until the site admin releases it. */
export function recordIntake(store: ModerationStore, intake: Intake, opts: { surface: UploadSurface; actor: string }) {
  const { upload, verdict } = intake;
  if (verdict.action !== 'quarantine' || store.state(upload.sha).quarantined) return null;
  return store.append({ sha: upload.sha, action: 'quarantine', actor: `classifier:${verdict.classifier}`, role: 'classifier', reason: verdict.reason ?? verdict.labels.join(', '), detail: { surface: opts.surface, uploader: opts.actor, labels: verdict.labels, score: verdict.score ?? null } });
}
