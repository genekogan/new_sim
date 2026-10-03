import * as THREE from 'three';
import { clearWeather, type Weather } from '../../simulation/shared';
/** Fixed GPU budget: one draw call, no per-frame particle allocation or simulation. */
export function createWeather(scene: THREE.Scene) {
  const count = 2400,
    positions = new Float32Array(count * 6),
    seeds = new Float32Array(count * 6);
  let seed = 812;
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < count; i++) {
    const x = random(),
      y = random(),
      z = random();
    for (let j = 0; j < 2; j++) {
      positions[(i * 2 + j) * 3 + 1] = j;
      seeds.set([x, y, z], (i * 2 + j) * 3);
    }
  }
  const roofData = new Float32Array(256 * 256).fill(-0.16),
    roof = new THREE.DataTexture(
      roofData,
      256,
      256,
      THREE.RedFormat,
      THREE.FloatType,
    );
  roof.needsUpdate = true;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 3));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      time: { value: 0 },
      strength: { value: 0 },
      drift: { value: new THREE.Vector2() },
      center: { value: new THREE.Vector3() },
      roof: { value: roof },
    },
    vertexShader: `attribute vec3 seed;uniform float time;uniform float strength;uniform vec2 drift;uniform vec3 center;uniform sampler2D roof;varying float alpha;
 void main(){vec3 p=vec3((seed.x-.5)*110.,mod(seed.y*40.-time*18.,40.),(seed.z-.5)*110.);p.xz+=center.xz;p.xz+=drift*(40.-p.y)*.2; p.y+=position.y*.45;float ceiling=texture2D(roof,(p.xz+220.)/440.).r;alpha=step(seed.x,strength)*step(ceiling+.1,p.y);gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}`,
    fragmentShader: `varying float alpha;void main(){if(alpha<.5)discard;gl_FragColor=vec4(.65,.76,.84,.35);}`,
  });
  const rain = new THREE.LineSegments(geometry, material);
  rain.frustumCulled = false;
  rain.name = 'Rain';
  scene.add(rain);
  return {
    rebuild(root: THREE.Group) {
      roofData.fill(-0.16);
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        let p: THREE.Object3D | null = o,
          roofLayer = false;
        while (p) {
          if (
            p.userData.layer === 'Aerial reference' ||
            p.userData.kind === 'context_person'
          )
            return;
          if (p.userData.layer === 'Roofs and upper floors') roofLayer = true;
          p = p.parent;
        }
        if (!roofLayer) return;
        const b = new THREE.Box3().setFromObject(o);
        if (b.max.y < 2) return;
        for (
          let z = Math.max(0, Math.floor(((b.min.z + 220) / 440) * 256));
          z <= Math.min(255, Math.ceil(((b.max.z + 220) / 440) * 256));
          z++
        )
          for (
            let x = Math.max(0, Math.floor(((b.min.x + 220) / 440) * 256));
            x <= Math.min(255, Math.ceil(((b.max.x + 220) / 440) * 256));
            x++
          )
            roofData[z * 256 + x] = Math.max(roofData[z * 256 + x], b.max.y);
      });
      roof.needsUpdate = true;
    },
    update(time: number, camera: THREE.Camera, w: Weather = clearWeather) {
      rain.visible = w.rain > 0;
      material.uniforms.time.value = time;
      material.uniforms.strength.value = w.rain;
      material.uniforms.center.value.copy(camera.position);
      const a = (w.windDirection * Math.PI) / 180;
      material.uniforms.drift.value.set(
        Math.cos(a) * w.wind,
        Math.sin(a) * w.wind,
      );
    },
    dispose() {
      scene.remove(rain);
      geometry.dispose();
      material.dispose();
      roof.dispose();
    },
  };
}
