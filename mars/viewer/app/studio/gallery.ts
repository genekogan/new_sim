import * as THREE from 'three';
import {gallery2026Mounts,projection2026Mount} from '../history/gallery-2026-anchors';
import { ThreeResources, isVisible } from '../../lib/three-resources';
import {
  screenIds,
  type SimState,
  type ScreenState,
} from '../../simulation/shared';
/** Photo-informed presentation overlay from ref-110/ref-011, not surveyed fixtures.
 * Portrait hall projection plus two tiers of small monitors on pale plywood panels. */
export function createGallery(scene: THREE.Scene, root: THREE.Group) {
  const group = new THREE.Group();
  group.name = 'Photo-informed gallery screens';
  group.matrixAutoUpdate = false;
  const chiba = root.getObjectByName('Chiba') ?? root;
  scene.add(group);
  const owned = new ThreeResources(),
    origin = new THREE.Vector3(6.02069, 0, 8.3088),
    u = new THREE.Vector3(-0.4626, 0, 0.8866),
    n = new THREE.Vector3(-0.8866, 0, -0.4626);
  const back = new THREE.MeshStandardMaterial({
      color: 0xc9c0a5,
      roughness: 0.9,
    }),
    black = new THREE.MeshStandardMaterial({ color: 0x141619, roughness: 0.6 });
  const mounts=gallery2026Mounts(root),projectionMount=projection2026Mount(root);
  const intoChiba=chiba.matrixWorld.clone().invert();
  const physicalPads:THREE.Object3D[]=[];root.traverse(o=>{if(o.userData.kind==='auditorium gallery pale backing panel')physicalPads.push(o);if(/auditorium gallery small screen bezel|auditorium gallery screen surface/.test(o.userData.kind??''))o.visible=false;});
  const screens = screenIds.map((id, i) => {
    const projector = i === 0,
      width = projector ? 3.2 : .49,
      height = projector ? 4.3 : .32;
    const holder = new THREE.Group();
    holder.name='Gallery receiver-mounted screen '+id;
    const mount=projector?projectionMount:mounts[i-1];
    if(mount){
      holder.position.copy(mount.point.clone().addScaledVector(mount.normal,projector?.004:((mount as {standOff?:number}).standOff??0)+.040).applyMatrix4(intoChiba));
      holder.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),mount.normal.clone().transformDirection(intoChiba));
      holder.userData.receiverId=mount.receiverId;
      holder.userData.receiverMounted20261001=true;
    }else{holder.visible=false;holder.userData.missingReceiver=true;}
    group.add(holder);
    if (!projector) {
      if(!physicalPads.length){const panel = new THREE.Mesh(new THREE.BoxGeometry(.68, .56, .035), back);panel.position.z = -.020;holder.add(panel);}
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.07, height + 0.07, 0.06),
        black,
      );
      holder.add(frame);
    }
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = projector ? 688 : 288;
    const ctx = canvas.getContext('2d')!,
      texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        power: { value: 0 },
        idleColor: { value: new THREE.Color(projector ? 0xc9c8b7 : 0x020202) },
        program: { value: 0 },
        label: { value: texture },
        aspect: { value: width / height },
        seed: { value: i },
      },
      vertexShader:
        'varying vec2 uvScreen; void main(){uvScreen=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec2 uvScreen;uniform float time,power,program,aspect,seed;uniform sampler2D label;uniform vec3 idleColor;
   void main(){vec2 p=(uvScreen-.5)*vec2(aspect,1.);float r=length(p),a=atan(p.y,p.x);vec3 color;
   if(program<.5){float petals=sin(a*8.+time*.25+seed)*.05+.22;float glow=exp(-abs(r-petals)*90.);float inner=exp(-abs(r-.14-sin(a*6.-time*.3)*.025)*110.);color=vec3(.02,.015,.05)+(vec3(.25,.5,1.)*glow+vec3(.8,.2,.65)*inner)*1.6;}
   else if(program<1.5){color=texture2D(label,uvScreen).rgb;}
   else{color=.5+.5*cos(vec3(0.,2.,4.)+uvScreen.x*6.28);color*=.4+.6*step(.5,fract(uvScreen.y*8.));}
   gl_FragColor=vec4(mix(idleColor,color,clamp(power,0.,1.))*max(1.,power),1.);
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
   }`,
    });
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      material,
    );
    face.position.z = projector ? 0 : .04;
    holder.add(face);
    let title = '';
    return {
      id,
      material,
      texture,
      paint(text: string) {
        if (title === text) return;
        title = text;
        ctx.fillStyle = '#111829';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#a7e6da';
        ctx.font = '22px sans-serif';
        ctx.fillText('MARS COLLEGE', 30, 60);
        ctx.fillStyle = 'white';
        ctx.font = '28px sans-serif';
        const words = text.split(/\s+/);
        let line = '',
          y = canvas.height * 0.4;
        for (const word of words) {
          if (ctx.measureText(line + word).width > 445) {
            ctx.fillText(line, 30, y);
            y += 38;
            line = '';
          }
          line += word + ' ';
        }
        ctx.fillText(line, 30, y);
      },
      holder,
    };
  });
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffddb0 }),
    bulbs = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.045, 6, 4),
      bulbMat,
      56,
    ),
    matrix = new THREE.Matrix4();
  for (let i = 0; i < 56; i++) {
    const p = origin
      .clone()
      .addScaledVector(n, (i % 14) * 0.6)
      .addScaledVector(u, Math.floor(i / 14) % 2 ? 3.5 : -1.8);
    p.y = i < 28 ? 3.05 : 5.6;
    matrix.makeTranslation(p);
    bulbs.setMatrixAt(i, matrix);
  }
  group.add(bulbs);
  const lights = [1.4, 4.4].map((y) => {
    const light = new THREE.PointLight(0xffcd99, 0, 11, 2);
    light.position.copy(origin).addScaledVector(n, 3);
    light.position.y = y;
    group.add(light);
    return light;
  });
  owned.object(group);
  return {
    update(state: SimState | null, time: number, cut: string) {
      chiba.updateWorldMatrix(true, false);
      group.matrix.copy(chiba.matrixWorld);
      group.visible = isVisible(chiba) && cut !== 'frame';
      let any = false;
      for (const s of screens) {
        const v: ScreenState = state?.screens?.[s.id] ?? {
          enabled: true,
          program: 'art',
          brightness: 1,
          title: 'Mars College',
        };
        s.material.uniforms.time.value = time;
        s.material.uniforms.power.value = v.enabled ? v.brightness : 0;
        s.material.uniforms.program.value = ['art', 'talk', 'test'].indexOf(
          v.program,
        );
        if (v.enabled && v.program === 'talk') {
          s.paint(v.title);
          if (s.texture.userData.title !== v.title) {
            s.texture.needsUpdate = true;
            s.texture.userData.title = v.title;
          }
        }
        any ||= v.enabled;
      }
      bulbs.visible = any;
      lights.forEach((l) => (l.intensity = any ? 10 : 0));
    },
    dispose() {
      scene.remove(group);
      owned.dispose();
    },
  };
}
