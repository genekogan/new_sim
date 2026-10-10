// The Soul-facing look picker: parts, props, pattern, colours, head size, randomize, live 3D preview and the
// profile icon rendered from the composed body. Self-contained (own small renderer), so it can sit in the
// lab or in the owner's Soul panel. `onSave` receives the compact params (what PUT /v1/edge/body stores).
import {useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createRig, type Rig} from '../../../../mars/viewer/app/engine-view/people.ts';
import {WorldSoulAvatars, soulAvatars} from '../SoulAvatars.ts';
import {humanoidKit, type HumanoidKit, type KitManifest} from './compose.ts';
import {appearanceFromSeed, compactLook, describeLook, editLook, HUMANOID_PARAMS, lookKey, resolveLook, COLOR_KEYS, type Look} from './look.ts';

const CHOICES = ['frame', 'face', 'hair', 'top', 'bottom', 'shoes', 'hat', 'glasses', 'bag', 'pattern'] as const;
const NAMES: Record<string, string> = {frame: 'Frame', face: 'Face', hair: 'Hair', top: 'Top', bottom: 'Bottom', shoes: 'Shoes', hat: 'Hat', glasses: 'Glasses', bag: 'Bag', pattern: 'Pattern',
  skin: 'Skin', hair1: 'Hair colour', brows: 'Brows', eyes: 'Eyes', top1: 'Top', top2: 'Top accent', bottom1: 'Bottom', shoes1: 'Shoes', soles: 'Soles', accent: 'Trinkets', gear: 'Hat / bag'};
const FRAME_LABEL: Record<string, string> = {masc: 'Broad (masc)', fem: 'Slender (fem)'};
const SKINS = ['#f3d4bc', '#dcae86', '#cead86', '#b97750', '#8f5b3f', '#64391f', '#3b2216'];
export const pickerKit = () => humanoidKit(new GLTFLoader());

type Props = {initial?: unknown; kit?: HumanoidKit; onSave?: (params: Partial<Look>) => Promise<void> | void; onState?: (s: Record<string, unknown>) => void; saveLabel?: string};
export function LookPicker({initial, kit = pickerKit(), onSave, onState, saveLabel = 'Use this look'}: Props) {
  const [look, setLook] = useState<Look>(() => resolveLook(initial ?? {}));
  const [manifest, setManifest] = useState<KitManifest | null>(null);
  const [icon, setIcon] = useState(''); const [busy, setBusy] = useState(false); const [note, setNote] = useState('');
  const host = useRef<HTMLDivElement>(null), view = useRef<{renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; rig?: Rig; avatars: WorldSoulAvatars; n: number} | null>(null);
  useEffect(() => { void kit.manifest().then(setManifest); }, [kit]);
  useEffect(() => { // own preview renderer
    const renderer = new THREE.WebGLRenderer({antialias: true, preserveDrawingBuffer: true}); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(300, 380);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#e9e6dc');
    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x6b5a45, 1.6)); const sun = new THREE.DirectionalLight(0xffffff, 2.4); sun.position.set(3, 6, 5); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(28, 300 / 380, 0.1, 50); camera.position.set(0, 1.25, 3.9); camera.lookAt(0, 0.93, 0);
    host.current!.appendChild(renderer.domElement); renderer.domElement.setAttribute('aria-label', 'Preview of the look');
    view.current = {renderer, scene, camera, avatars: new WorldSoulAvatars(renderer), n: 0};
    return () => { renderer.dispose(); renderer.domElement.remove(); view.current = null; };
  }, []);
  const key = useMemo(() => lookKey(look), [look]);
  useEffect(() => { let live = true; void kit.template(look).then(t => {
    const v = view.current; if (!live || !v) return;
    if (v.rig) v.scene.remove(v.rig.holder);
    const rig = createRig(t); rig.holder.rotation.y = -Math.PI / 2 + 0.35; rig.idle.time = 0.4; rig.mixer.update(0); v.scene.add(rig.holder); v.rig = rig;
    v.renderer.render(v.scene, v.camera);
    v.avatars.capture('picker', key, rig.holder, false, (++v.n) * 1000); setIcon(soulAvatars.images.get('picker') ?? '');
    v.renderer.render(v.scene, v.camera);
    onState?.({ready: true, key, look, icon: !!soulAvatars.images.get('picker'), kitBytes: kit.bytes});
  }).catch(e => setNote(e instanceof Error ? e.message : String(e))); return () => { live = false; }; }, [key]);
  const set = (k: string, v: string | number) => setLook(l => editLook(l, {[k]: v}));
  const label = (k: string, v: string) => k === 'frame' ? FRAME_LABEL[v] ?? v : manifest?.parts[k]?.[v]?.label ?? (v === 'none' ? 'None' : v === 'bald' ? 'Bald' : v[0].toUpperCase() + v.slice(1));
  const compact = compactLook(look);
  const cli = look.preset !== 'none' ? `body look --set preset=${look.preset}` : 'body look --set ' + Object.entries(compact).map(([k, v]) => `${k}=${v}`).join(' ');
  return <div className="look-picker">
    <div style={{display: 'flex', gap: 10, alignItems: 'center'}}>
      {icon ? <img src={icon} alt="Profile icon from this look" width={72} height={72} style={{borderRadius: '50%', boxShadow: '0 0 0 1px #0002'}} /> : null}
      <div><strong>Look</strong><div style={{fontSize: 12, color: '#6a6255'}}>{describeLook(look)}</div></div>
    </div>
    <div ref={host} style={{margin: '8px 0'}} />
    <div style={{display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0'}}>
      <button type="button" onClick={() => setLook(appearanceFromSeed((Math.random() * 2 ** 32) >>> 0))}>Randomize</button>
      {(['casual', 'punk', 'woman'] as const).map(p => <button type="button" key={p} aria-pressed={look.preset === p} onClick={() => set('preset', p)}>Classic {p}</button>)}
    </div>
    <fieldset style={{border: 0, padding: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 8px', alignItems: 'center'}}>
      {CHOICES.map(k => <label key={k} style={{display: 'contents'}}><span>{NAMES[k]}</span>
        <select value={look[k] as string} onChange={e => set(k, e.target.value)}>{(HUMANOID_PARAMS[k] as {values: string[]}).values.map(v => <option key={v} value={v}>{label(k, v)}</option>)}</select></label>)}
      <label style={{display: 'contents'}}><span>Head size</span><input type="range" min={0.9} max={1.1} step={0.01} value={look.headScale} onChange={e => set('headScale', Number(e.target.value))} /></label>
    </fieldset>
    <div style={{display: 'flex', gap: 4, margin: '8px 0 4px'}}>{SKINS.map(s => <button type="button" key={s} aria-label={'Skin ' + s} onClick={() => set('skin', s)} style={{width: 22, height: 22, borderRadius: '50%', background: s, border: look.skin === s ? '2px solid #2a2620' : '1px solid #0003'}} />)}</div>
    <fieldset style={{border: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(2, auto 1fr)', gap: '4px 6px', alignItems: 'center'}}>
      {COLOR_KEYS.map(k => <label key={k} style={{display: 'contents'}}><span style={{fontSize: 12}}>{NAMES[k]}</span><input type="color" value={look[k]} onChange={e => set(k, e.target.value)} /></label>)}
    </fieldset>
    <details style={{marginTop: 8}}><summary>For the Soul's CLI</summary><code style={{fontSize: 11, wordBreak: 'break-all'}}>{cli}</code></details>
    {onSave ? <button type="button" disabled={busy} style={{marginTop: 10}} onClick={async () => { setBusy(true); setNote(''); try { await onSave(compact); setNote('Saved.'); } catch (e) { setNote(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }}>{saveLabel}</button> : null}
    {note ? <p role="status" style={{fontSize: 12}}>{note}</p> : null}
  </div>;
}
export async function mountLookPicker(el: HTMLElement, props: Props & Record<string, unknown>) { createRoot(el).render(<LookPicker {...props} />); }
