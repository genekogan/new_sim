import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldViewerHandle, viewerPresentation, cameraModeAfterGesture, WORLD_VIEWER_CAPABILITIES, type WorldViewerPort } from '../src/WorldViewer.ts';

test('presentation identifies the displayed frame, history and unavailable startup without inventing tick zero', () => {
  const input = { drawnTick: null, history: false, playing: false, cameraMode: 'broadcast' as const,
    soulId: null, entityId: null, loading: true, unavailableReason: 'Waiting for a recorded world frame.' };
  assert.equal(viewerPresentation(input).shownTick, null);
  assert.equal(viewerPresentation(input).playback, 'live');
  const history = viewerPresentation({ ...input, drawnTick: 25.5, history: true, loading: false, soulId: 'soul-1', entityId: 'body-1', unavailableReason: null });
  assert.deepEqual(history, { shownTick: 25.5, presentation: 'history', cameraMode: 'broadcast', selection: { soulId: 'soul-1', entityId: 'body-1' }, playback: 'paused', loading: false, unavailableReason: null, inputScope: 'viewport-pointer' });
  assert.equal(viewerPresentation({ ...input, drawnTick: NaN }).shownTick, null);
  assert.equal(viewerPresentation({ ...input, history: true, playing: true }).playback, 'playing');
  const lost = viewerPresentation({ ...input, drawnTick: 25.5, loading: false, unavailableReason: 'The 3D graphics context was lost.' });
  assert.equal(lost.shownTick, 25.5);
  assert.match(lost.unavailableReason!, /context/);
});

test('the published handle validates canonical IDs and uses current ports after a world/selection change', async () => {
  const calls: unknown[] = [];
  const make = (suffix: string): WorldViewerPort => ({
    setCameraMode: mode => calls.push(['mode', mode]), frameAll: () => calls.push(['frameAll']), focusSelected: () => true,
    hasSoul: id => id === 'soul-' + suffix, hasEntity: id => id === 'body-' + suffix,
    select: (soul, entity) => calls.push(['selection', soul, entity]), seek: async tick => { calls.push(['seek', tick]); },
    live: () => calls.push(['live']), setPlaying: () => false,
  });
  let port = make('a'); const handle = createWorldViewerHandle(() => port);
  assert.equal(handle.selectSoul('body-a'), false);
  assert.equal(handle.selectEntity('soul-a'), false);
  assert.equal(handle.selectSoul('soul-a'), true);
  port = make('b');
  assert.equal(handle.selectSoul('soul-a'), false);
  assert.equal(handle.selectEntity('body-b'), true);
  assert.equal(handle.selectSoul(null), true);
  await handle.seek(NaN); await handle.seek(Infinity); await handle.seek(25.5);
  assert.equal(handle.setPlaying(false), false, 'live world pause is not a viewer command');
  handle.live(); handle.frameAll();
  handle.setCameraMode('invalid' as never);
  assert.deepEqual(calls, [['selection','soul-a',null],['selection',null,'body-b'],['selection',null,null],['seek',25.5],['live'],['frameAll']]);
});

test('camera gesture preserves Follow and navigation qualification is explicit', () => {
  assert.equal(cameraModeAfterGesture('follow'), 'follow');
  assert.equal(cameraModeAfterGesture('manual'), 'manual');
  assert.equal(cameraModeAfterGesture('broadcast'), 'manual');
  assert.equal(WORLD_VIEWER_CAPABILITIES.manualFree, 'controls-preview');
  assert.equal(WORLD_VIEWER_CAPABILITIES.keyboardNavigation, 'controls-preview');
  assert.equal(WORLD_VIEWER_CAPABILITIES.releaseInput, true);
});


test('decorative kin inspection never publishes a canonical entity selection in startup or drawn state', () => {
  const base = { drawnTick: null, history: false, playing: false, cameraMode: 'manual' as const,
    soulId: null, entityId: 'kin:0:chewe', loading: true, unavailableReason: 'Waiting for a recorded world frame.' };
  assert.deepEqual(viewerPresentation(base).selection,{soulId:null,entityId:null});
  assert.deepEqual(viewerPresentation({...base,drawnTick:25.5,loading:false,unavailableReason:null}).selection,{soulId:null,entityId:null});
  assert.deepEqual(viewerPresentation({...base,entityId:'body-1'}).selection,{soulId:null,entityId:'body-1'});
  assert.deepEqual(viewerPresentation({...base,soulId:'soul-1',entityId:'body-1'}).selection,{soulId:'soul-1',entityId:'body-1'});
  assert.deepEqual(viewerPresentation({...base,entityId:null}).selection,{soulId:null,entityId:null});
  let changed = false;
  const handle = createWorldViewerHandle(() => ({ setCameraMode() {},frameAll() {},focusSelected:()=>false,
    hasSoul:()=>false,hasEntity:id=>id==='body-1',select:()=>{changed=true;},seek:async()=>{},live() {},setPlaying:()=>false }));
  assert.equal(handle.selectEntity('kin:0:chewe'),false);
  assert.equal(changed,false,'display IDs cannot select a canonical actor through the handle');
});


test('optional navigation commands keep old ports compatible and delegate through the current port',()=>{
  const calls:unknown[]=[];
  let port:WorldViewerPort={setCameraMode(){},frameAll(){},focusSelected:()=>false,hasSoul:()=>false,hasEntity:()=>false,select(){},seek:async()=>{},live(){},setPlaying:()=>false};
  const handle=createWorldViewerHandle(()=>port);
  assert.equal(handle.resetView?.(),false);assert.equal(handle.moveCamera?.({up:.5}),false);handle.releaseInput?.();handle.setManualNavigation?.('free');
  port={...port,setManualNavigation:mode=>calls.push(['navigation',mode]),resetView:()=>{calls.push(['reset']);return true;},releaseInput:()=>{calls.push(['release']);},moveCamera:delta=>{calls.push(['move',delta]);return true;}};
  handle.setManualNavigation?.('invalid' as never);handle.setManualNavigation?.('free');
  assert.equal(handle.resetView?.(),true);handle.releaseInput?.();assert.equal(handle.moveCamera?.({forward:.5}),true);
  assert.deepEqual(calls,[['navigation','free'],['reset'],['release'],['move',{forward:.5}]]);
  assert.equal(viewerPresentation({drawnTick:10,history:false,playing:false,cameraMode:'manual',soulId:null,entityId:null,loading:false,unavailableReason:null,manualNavigation:'free',inputOwned:true}).inputOwned,true);
});
