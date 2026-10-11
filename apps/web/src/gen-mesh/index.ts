// Entry point: loads the registry first, then every *.mesh.ts (each calls registerMesh at import).
// A separate module because eager globs are hoisted above the importing module's own code.
export { meshFor, registerMesh, registeredMeshes, type MeshBuilder, type MeshCtx } from './registry.ts';
import.meta.glob('./**/*.mesh.ts', { eager: true });
// VOCAB-W2: the sound layer (components.sound → procedural WebAudio; new worlds only, after a gesture)
import './sound.ts';
