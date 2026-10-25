import * as THREE from 'three';
/** D1: a simple open car drawn at a native ride carrier's pose (a god ferris wheel or carousel: the thing itself stays put
 *  and its decorative gondolas keep their own clock; the rider is carried by this car). Car-local space as the balloon
 *  basket's: origin = floor centre (Core's floorY, where riders stand), +x forward. Presentation only. */
const L = 1.5, W = 1.2, WALL = 0.8, T = 0.06, BAR = 2.3;
export class WorldRideCars {
  readonly group = new THREE.Group();
  private cars = new Map<string, THREE.Group>();
  private body = new THREE.MeshStandardMaterial({color: '#c8553d', roughness: 0.7});
  private trim = new THREE.MeshStandardMaterial({color: '#e9e2d0', roughness: 0.6});
  private geo = {floor: new THREE.BoxGeometry(L, T, W), side: new THREE.BoxGeometry(L, WALL, T), end: new THREE.BoxGeometry(T, WALL, W), post: new THREE.BoxGeometry(0.05, BAR - WALL, 0.05), bar: new THREE.BoxGeometry(0.06, 0.06, W)};
  constructor() {this.group.name = 'ride-cars';}
  private build(id: string) {
    const g = new THREE.Group(); g.name = `ride-car:${id}`;
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o);};
    add(this.geo.floor, this.body, 0, -T / 2, 0);
    for (const z of [-W / 2, W / 2]) add(this.geo.side, this.body, 0, WALL / 2, z);
    for (const x of [-L / 2, L / 2]) add(this.geo.end, this.body, x, WALL / 2, 0);
    // the hanger: two posts from the side walls' middle up to a bar over the riders' heads (where it hangs from the wheel)
    for (const z of [-W / 2, W / 2]) add(this.geo.post, this.trim, 0, WALL + (BAR - WALL) / 2, z);
    add(this.geo.bar, this.trim, 0, BAR, 0);
    this.group.add(g); this.cars.set(id, g); return g;
  }
  /** Place one car per carrier (Core convention: rotation.y = -yaw); cars of carriers no longer listed are removed. */
  update(carriers: readonly {id: string; p: readonly number[]; yaw: number}[]) {
    const keep = new Set<string>();
    for (const c of carriers) {keep.add(c.id); const g = this.cars.get(c.id) ?? this.build(c.id); g.position.set(c.p[0], c.p[1], c.p[2]); g.rotation.y = -c.yaw; g.visible = true;}
    for (const [id, g] of this.cars) if (!keep.has(id)) {this.group.remove(g); this.cars.delete(id);}
  }
  dispose() {for (const g of Object.values(this.geo)) g.dispose(); this.body.dispose(); this.trim.dispose(); this.group.clear(); this.cars.clear();}
}
