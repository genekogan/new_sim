// Read-only arithmetic on exact proposed geometry and the existing camp bill.
// This does not create supports, admit movement or prove collision/physics.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CATALOG } from '../../mars/viewer/engine/world/catalog.ts';
import { ENGINE_ACTIONS, ENGINE_RULES_VERSION } from '../../mars/viewer/engine/api/registry.ts';

const cwd = fileURLToPath(new URL('../..', import.meta.url));
const proposalPin = '86dad3685d07f4819aacb048315f9e769e13d783';
const basePin = '621af25689d50e1fd10ff9bd236d0d5c70e20e15';
const at = (pin, path) => JSON.parse(execFileSync('git', ['show', `${pin}:${path}`], { cwd, encoding: 'utf8' }));
const eden = at(proposalPin, 'worlds/eden/assets/fixtures/shore-dock-proposal.v1.json');
const mars = at(proposalPin, 'worlds/mars/assets/fixtures/camp-expansion-proposal.v1.json');
const camp = at(basePin, 'worlds/mars/camp/manifest.json');
for (const path of ['mars/viewer/engine/world/catalog.ts', 'mars/viewer/engine/world/catalog-stock.ts',
  'mars/viewer/engine/world/catalog-phase-b.ts', 'mars/viewer/engine/api/registry.ts']) {
  const blob = pin => execFileSync('git', ['rev-parse', `${pin}:${path}`], { cwd, encoding: 'utf8' }).trim();
  if (blob(basePin) !== blob('HEAD')) throw Error(`source changed: re-pin analysis for ${path}`);
}
const finite = values => values.every(Number.isFinite);
const box = bounds => finite(bounds) && bounds.length === 4 && bounds[0] < bounds[2] && bounds[1] < bounds[3];
for (const p of [eden, mars]) {
  if (p.schema !== 'world-geometry-proposal/1' || p.units !== 'metres' || p.axes.up !== '+Y' || p.axes.ground !== 'XZ' || p.axes.yawZero !== '+X' || !box(p.boundsXZ)) throw Error('unsupported geometry proposal');
}
const t = eden.terrain, heights = t.heightMetres;
if (t.spacingMetres <= 0 || !Number.isInteger(t.columns) || !Number.isInteger(t.rows) || heights.length !== t.rows || heights.some(row => row.length !== t.columns || !finite(row))) throw Error('invalid terrain grid');
const extent = [t.originXZ[0], t.originXZ[1], t.originXZ[0] + (t.columns - 1) * t.spacingMetres, t.originXZ[1] + (t.rows - 1) * t.spacingMetres];
if (JSON.stringify(extent) !== JSON.stringify(eden.boundsXZ)) throw Error('terrain extent does not match world bounds');
let maxGrade = 0;
for (let z = 0; z < t.rows - 1; z++) for (let x = 0; x < t.columns - 1; x++) {
  // Both planar triangle gradients for the fixed NW→SE cell diagonal.
  const a = heights[z][x], b = heights[z][x+1], c = heights[z+1][x], d = heights[z+1][x+1];
  maxGrade = Math.max(maxGrade, Math.hypot(b-a,d-b)/t.spacingMetres, Math.hypot(d-c,c-a)/t.spacingMetres);
}
function bed(x,z) {
  const fx=(x-t.originXZ[0])/t.spacingMetres, fz=(z-t.originXZ[1])/t.spacingMetres;
  if (fx<0 || fz<0 || fx>t.columns-1 || fz>t.rows-1) throw Error('sample outside terrain');
  const ix=Math.min(Math.floor(fx),t.columns-2), iz=Math.min(Math.floor(fz),t.rows-2), dx=fx-ix,dz=fz-iz;
  // For this proposal every row is identical: triangle vs bilinear is identical.
  return (1-dz)*((1-dx)*heights[iz][ix]+dx*heights[iz][ix+1])+dz*((1-dx)*heights[iz+1][ix]+dx*heights[iz+1][ix+1]);
}
if (heights.some(row => JSON.stringify(row)!==JSON.stringify(heights[0]))) throw Error('update region-extrema analysis for nonidentical rows');
const depth = (x,z) => Math.max(0, eden.water.datumY-bed(x,z));
const regionDepths = eden.water.regions.map(r => {
  const b=r.boundsXZ;if(!box(b))throw Error('invalid water region');
  const xs=[b[0],b[2],...Array.from({length:t.columns},(_,i)=>t.originXZ[0]+i*t.spacingMetres).filter(x=>x>b[0]&&x<b[2])];
  const values=xs.flatMap(x=>[depth(x,b[1]),depth(x,b[3])]);
  return {id:r.id,minClampedDepthMetres:Math.min(...values),maxDepthMetres:Math.max(...values),containsDryBed:xs.some(x=>bed(x,b[1])>=eden.water.datumY)};
});
const d=eden.dock,b=eden.boat,centre=b.poseProposal.p;
if (b.poseProposal.yaw!==0) throw Error('update OBB arithmetic for rotated boat');
const boatXZ=[centre[0]-b.sizeXYZ[0]/2,centre[2]-b.sizeXYZ[2]/2,centre[0]+b.sizeXYZ[0]/2,centre[2]+b.sizeXYZ[2]/2];
const dockTop=d.centre[1]+d.sizeXYZ[1]/2,boatTop=centre[1]+b.sizeXYZ[1]/2,keel=centre[1]-b.sizeXYZ[1]/2;
const board=d.boardingAnchors[0].p, local=b.localBoardingAnchor.p, aboard=local.map((v,i)=>v+centre[i]);
const ramp=d.shoreConnectionProposal.path,run=Math.hypot(ramp[1][0]-ramp[0][0],ramp[1][2]-ramp[0][2]);
const counts=new Map();
for(const c of camp.construction.components)counts.set(c.def,(counts.get(c.def)??0)+1);
const kit=[...counts].sort(([a],[b])=>a.localeCompare(b)).map(([def,count])=>{
 const asset=CATALOG[def];if(!asset)throw Error(`unknown catalog component ${def}`);
 return {def,countPerExistingLookout:count,countForTwoCopies:2*count,massKgPerPiece:asset.massKg};
});
const report={
 status:'analytic proposal review only; no runtime/manifest/physics/admission qualification',
 source:{proposalPin,campBasePin:basePin,engineRulesVersion:ENGINE_RULES_VERSION},
 eden:{terrainExtentXZ:extent,maxTriangleGrade:maxGrade,maxGradeDegrees:Math.atan(maxGrade)*180/Math.PI,regionDepths,
  dockTopMetres:dockTop,boatBoxTopMetres:boatTop,boatBoxKeelMetres:keel,boatFootprintXZ:boatXZ,
  minimumBoxKeelClearanceMetres:keel-Math.max(...[boatXZ[0],boatXZ[2]].flatMap(x=>[bed(x,boatXZ[1]),bed(x,boatXZ[3])])),
  dockBoatBoxGapMetres:boatXZ[1]-(d.centre[2]+d.sizeXYZ[2]/2),
  dockBoardingPoint:board,boatBoardingPoint:aboard,boardingHorizontalDistanceMetres:Math.hypot(aboard[0]-board[0],aboard[2]-board[2]),boardingDeltaYMetres:aboard[1]-board[1],
  rampGrade:(ramp[1][1]-ramp[0][1])/run,rampAngleDegrees:Math.atan((ramp[1][1]-ramp[0][1])/run)*180/Math.PI,rampGroundEndDeltaMetres:ramp[1][1]-bed(ramp[1][0],ramp[1][2]),
  seatAnchorSeparationMetres:Math.hypot(...b.localPassengerAnchors[0].p.map((v,i)=>v-b.localPassengerAnchors[1].p[i]))},
 mars:{upperFloorBoxTopMetres:mars.upperFloor.centre[1]+mars.upperFloor.sizeXYZ[1]/2,declaredStairExitY:mars.upperFloor.stairProposal.exit[1],
  stairGrade:mars.upperFloor.stairProposal.rise/Math.hypot(mars.upperFloor.stairProposal.exit[0]-mars.upperFloor.stairProposal.entry[0],mars.upperFloor.stairProposal.exit[2]-mars.upperFloor.stairProposal.entry[2]),
  upperFloorAreaMetres2:mars.upperFloor.sizeXYZ[0]*mars.upperFloor.sizeXYZ[2],poolPlanAreaMetres2:(()=>{const p=mars.zones.find(z=>z.id==='mars-constructed-pool').boundsXZ;return(p[2]-p[0])*(p[3]-p[1]);})(),
  existingLookoutBill:kit,totalComponentsPerExistingLookout:kit.reduce((n,k)=>n+k.countPerExistingLookout,0),
  totalComponentsForTwoCopies:kit.reduce((n,k)=>n+k.countForTwoCopies,0),massKgForTwoCopies:kit.reduce((n,k)=>n+k.countForTwoCopies*k.massKgPerPiece,0),
  repairStock:'not specified/qualified; cannot infer quantity or recovery ratio',
  expandedUpperFloorBill:'not the existing lookout kit; design and supporting members still required'},
 registeredPhysicalVerbs:[...ENGINE_ACTIONS].map(a=>a.verb).sort(),
 assumptions:['water depth computed only where bed is below datum; closed wetted domain not supplied',
  'boat dimensions treated as centred axis-aligned tight box for arithmetic, not a buoyancy/collision model',
  'boarding and passenger anchors are visual points; stand/seat/foot meanings and swept envelopes not supplied',
  'two existing lookout copies are an illustrative count, not approval for the expanded upper floor or genesis inventory']
};
console.log(JSON.stringify(report,null,2));
