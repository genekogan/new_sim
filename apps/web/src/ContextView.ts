import type { ContextPhotoTarget } from './context-photo-scene.ts';
import type { PhotoChoice } from './context-photographer.ts';
// Server-only payload injection. No socket, controller, live clock or continuing render loop.
import * as THREE from 'three';
import { WorldEntityLayer, type EntitySnapshot } from './WorldEntityLayer.ts';
import { WorldPlacePreviews } from './WorldPlacePreviews.ts';
import { Daylight } from './daylight.ts';
import { apiPath } from './world-path.ts';
import { whenAssetsSettled, assetFailed } from './gen-mesh/gltf-assets.ts';
import { releaseBuildingWorkersWhenIdle } from './gen-mesh/building.mesh.ts';
import { onRenderedImageFallback } from './gen-mesh/art-media.ts';
import { ContextTextureFailures } from './context-texture-failures.ts';
type Target = ContextPhotoTarget;
const global = window as unknown as {
    contextRender: (p: {
        snapshot: EntitySnapshot;
        target: Target;
        detail: boolean;
    }) => Promise<{
        data?: string;
        reason?: string;
        photo?: PhotoChoice;
    }>;
};
global.contextRender = async ({ snapshot, target, detail }) => {
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(detail ? 640 : 320, detail ? 448 : 224);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene(), layer = new WorldEntityLayer(apiPath), light = new Daylight(scene), ac = new AbortController();
    scene.add(layer.group);
    layer.cover.bindScene(scene);
    light.update('2026-06-21T10:30:00');
    let pending = 0;
    const failures = new ContextTextureFailures(location.href);
    const stopFallbacks = onRenderedImageFallback(url => failures.renderedFallback(url));
    const manager = THREE.DefaultLoadingManager, oldStart = manager.onStart, oldLoad = manager.onLoad, oldError = manager.onError;
    manager.onStart = () => { pending++; };
    manager.onLoad = () => { pending = 0; };
    manager.onError = url => { failures.failed(url); };
    const previews = new WorldPlacePreviews(renderer, () => [layer.group], () => scene);
    try {
        await layer.start(ac.signal, undefined, snapshot);
        await layer.fill;
        releaseBuildingWorkersWhenIdle();
        await whenAssetsSettled();
        // TextureLoader completes through the shared manager. Never label a partially loaded image current.
        const deadline = performance.now() + 15000;
        while (pending && performance.now() < deadline)
            await new Promise(r => setTimeout(r, 25));
        if (pending || failures.unresolved)
            return { reason: 'scene textures unavailable' };
        // Existing media-face crop callbacks run at 250 ms after image load.
        await new Promise(r => setTimeout(r, 260));
        layer.update(0, 3000);
        scene.updateMatrixWorld(true);
        if (!layer.active || layer.stats.lastError || Object.keys(snapshot.assetBytes ?? {}).some(assetFailed))
            return { reason: 'scene assets unavailable' };
        const result = await previews.captureContext(target, layer.contextMeshes(), detail, layer.contextGroundAt);
        return { data: result.url, photo: result.photo, reason: result.reason };
    }
    finally {
        stopFallbacks();
        manager.onStart = oldStart;
        manager.onLoad = oldLoad;
        manager.onError = oldError;
        ac.abort();
        previews.dispose();
        light.dispose();
        layer.dispose();
        renderer.dispose();
    }
};
