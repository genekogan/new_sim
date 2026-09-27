import { clearWeather, type Weather } from '../../simulation/shared';
import * as THREE from 'three';
import { CampusPaths, GROUND, campfireClearing } from './ambience-math';

/** Atmospheric set dressing, deliberately separate from the editable replica. */
export function createScenery(scene: THREE.Scene, paths: CampusPaths) {
  const group = new THREE.Group();
  group.name = 'Illustrative desert atmosphere';
  scene.add(group);
  let seed = 971;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const fire = new THREE.Group();
  group.add(fire);
  // Find an open clearing with at least 3 m clearance from the draft geometry.
  const clearing = campfireClearing(paths),
    site = clearing ? 1 : -1;
  if (clearing) fire.position.copy(clearing);
  else fire.visible = false;
  const rock = new THREE.DodecahedronGeometry(1, 0),
    rockMat = new THREE.MeshStandardMaterial({ color: 0x716b60, roughness: 1 });
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * Math.PI * 2,
      m = new THREE.Mesh(rock, rockMat);
    m.position.set(Math.sin(a) * 0.8, 0.1, Math.cos(a) * 0.8);
    m.scale.set(0.19, 0.14, 0.23);
    m.rotation.set(random(), random() * 6, random());
    m.castShadow = true;
    fire.add(m);
  }
  const wood = new THREE.CylinderGeometry(0.065, 0.1, 1.1, 7),
    woodMat = new THREE.MeshStandardMaterial({ color: 0x36291d, roughness: 1 });
  for (let i = 0; i < 5; i++) {
    const log = new THREE.Mesh(wood, woodMat);
    log.rotation.set(Math.PI / 2, 0, i * 1.26);
    log.position.set(0, 0.15 + i * 0.025, 0);
    fire.add(log);
  }
  const flameMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 }, strength: { value: 1 } },
    vertexShader: `attribute float seed; varying float age; varying float salt; uniform float time;
   void main(){age=fract(seed+time*.65);salt=seed;vec3 p=position;p.x+=sin(time*2.+seed*49.+age*5.)*.12*age;p.z+=age*age*.3;p.y+=age*1.4;
   vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=min(100.,(1.-age)*170./max(1.,-mv.z));}`,
    fragmentShader: `varying float age; varying float salt; uniform float strength;
   void main(){float r=length(gl_PointCoord-.5)*2.;float a=pow(max(0.,1.-r),2.)*(1.-age)*strength;
   gl_FragColor=vec4(mix(vec3(1.,.62,.12),vec3(1.,.12,.015),age),a);}`,
  });
  const flameGeo = new THREE.BufferGeometry(),
    pos = [],
    seeds = [];
  for (let i = 0; i < 95; i++) {
    const a = random() * 6.28,
      r = random() * 0.28;
    pos.push(Math.sin(a) * r, 0.24, Math.cos(a) * r);
    seeds.push(random());
  }
  flameGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  flameGeo.setAttribute('seed', new THREE.Float32BufferAttribute(seeds, 1));
  const flame = new THREE.Points(flameGeo, flameMat);
  flame.frustumCulled = false;
  fire.add(flame);
  const light = new THREE.PointLight(0xff872e, 35, 13, 2);
  light.position.y = 0.75;
  fire.add(light);
  const emberMat = new THREE.PointsMaterial({
    color: 0xffad50,
    size: 0.035,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const emberGeo = new THREE.BufferGeometry(),
    embers = new Float32Array(24 * 3);
  emberGeo.setAttribute('position', new THREE.BufferAttribute(embers, 3));
  fire.add(new THREE.Points(emberGeo, emberMat));
  // Sparse, straw-coloured desert grass outside the busy central footprint.
  const grassGeometry = new THREE.BufferGeometry(),
    blades: number[] = [];
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4,
      x = Math.cos(a) * 0.12,
      z = Math.sin(a) * 0.12,
      h = 0.25 + random() * 0.3;
    blades.push(
      x - 0.025,
      0,
      z,
      x + 0.025,
      0,
      z,
      x + Math.sin(a) * 0.2,
      h,
      z + 0.08,
    );
  }
  grassGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(blades, 3),
  );
  grassGeometry.computeVertexNormals();
  const wind = { value: 0 },
    grassMat = new THREE.MeshStandardMaterial({
      color: 0x8d8662,
      roughness: 1,
      side: THREE.DoubleSide,
    });
  grassMat.onBeforeCompile = (s) => {
    s.uniforms.windTime = wind;
    s.vertexShader = 'uniform float windTime;\n' + s.vertexShader;
    s.vertexShader = s.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
  transformed.x+=sin(windTime*1.6+instanceMatrix[3].x*.4+instanceMatrix[3].z*.3)*position.y*.17;`,
    );
  };
  const grass = new THREE.InstancedMesh(grassGeometry, grassMat, 160);
  group.add(grass);
  let count = 0;
  const matrix = new THREE.Matrix4(),
    q = new THREE.Quaternion();
  for (let i = 0; i < 800 && count < 160; i++) {
    const x = (random() - 0.5) * 115,
      z = (random() - 0.5) * 115;
    if (Math.hypot(x, z) < 30) continue;
    const id = paths.nearest(new THREE.Vector3(x, GROUND, z), 1);
    if (id < 0) continue;
    const p = paths.point(id);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * 6.28);
    matrix.compose(p, q, new THREE.Vector3().setScalar(0.6 + random()));
    grass.setMatrixAt(count++, matrix);
  }
  grass.count = count;
  // Fine windborne motes, low opacity rather than a sandstorm.
  const dustGeo = new THREE.BufferGeometry(),
    dustArray = new Float32Array(100 * 3);
  for (let i = 0; i < 100; i++) {
    dustArray[i * 3] = (random() - 0.5) * 100;
    dustArray[i * 3 + 1] = random() * 2 + 0.15;
    dustArray[i * 3 + 2] = (random() - 0.5) * 100;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustArray, 3));
  const dustMat = new THREE.PointsMaterial({
    color: 0xd0be9e,
    size: 0.035,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  group.add(dust);
  return {
    firePosition: site >= 0 ? fire.position.clone() : null,
    update(
      time: number,
      night: number,
      enabled: boolean,
      fireMode: string,
      weather: Weather = clearWeather,
    ) {
      group.visible = enabled;
      wind.value = time * (0.4 + weather.wind * 3);
      const angle = (weather.windDirection * Math.PI) / 180,
        offset = ((time * (0.22 + weather.wind * 2)) % 100) - 50;
      dust.position.set(Math.cos(angle) * offset, 0, Math.sin(angle) * offset);
      dustMat.opacity = 0.1 + weather.dust * 0.65;
      dustMat.size = 0.035 + weather.dust * 0.18;
      const strength =
        fireMode === 'on'
          ? 1
          : fireMode === 'off'
            ? 0
            : THREE.MathUtils.smoothstep(night, 0.04, 0.65);
      fire.visible = site >= 0 && strength > 0;
      flameMat.uniforms.time.value = time;
      flameMat.uniforms.strength.value = strength;
      light.intensity =
        strength * (32 + Math.sin(time * 13) * 5 + Math.sin(time * 23.7) * 3);
      for (let i = 0; i < 24; i++) {
        const age = (time * 0.24 + i * 0.618) % 1;
        embers[i * 3] = Math.sin(i * 4 + age * 3) * 0.18 + age * age * 0.6;
        embers[i * 3 + 1] = 0.3 + age * 2.5;
        embers[i * 3 + 2] = Math.cos(i * 3) * 0.2 + age * 0.15;
      }
      emberGeo.attributes.position.needsUpdate = true;
      emberMat.opacity = strength * 0.75;
    },
    dispose() {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
            m.dispose(),
          );
        }
      });
      scene.remove(group);
    },
  };
}
