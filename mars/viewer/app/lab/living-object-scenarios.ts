import { gardenAfternoonRuntime, gardenAfternoonScene } from '../../engine/scenarios/garden-afternoon.ts';
import { seedPlantingRuntime, seedPlantingScene } from '../../engine/scenarios/seed-planting.ts';
import { readingCircleRuntime, readingCircleScene } from '../../engine/scenarios/reading-circle.ts';
import { galleryTourRuntime, galleryTourScene } from '../../engine/scenarios/gallery-tour.ts';
import { tidyTableRuntime, tidyTableScene } from '../../engine/scenarios/table-cleanup.ts';
import { artSharingRuntime, artSharingScene } from '../../engine/scenarios/art-sharing.ts';
import { creativeAfternoonRuntime, creativeAfternoonScene, tickCreativeAfternoon } from '../../engine/scenarios/creative-afternoon.ts';
import { drawingWorkRuntime, drawingWorkScene } from '../../engine/scenarios/drawing-work.ts';
import { groupWarmupRuntime } from '../../engine/scenarios/group-warmup.ts';
import { openJamRuntime } from '../../engine/scenarios/open-jam.ts';
import type { Scenario } from './scenarios.ts';
import { Runtime } from '../../engine/runtime/runtime.ts';
import {
  createRegistry,
  ENGINE_INVARIANTS,
  servicesFor,
} from '../../engine/api/registry.ts';
import {
  gardenCareWorld,
  gardenCareScene,
} from '../../engine/scenarios/garden-care.ts';
import { musicGatheringRuntime } from '../../engine/scenarios/music-gathering.ts';
import { READING_SCENE } from '../../engine/scenarios/reading.ts';
const checks: Scenario['expect'] = (rt) => [
  {
    ok: rt.violations.length === 0,
    message: `authoritative invariant violations: ${rt.violations.length}`,
  },
];
export const LIVING_OBJECT_SCENARIOS: Scenario[] = [
  ...[0, Math.PI / 2].map((yaw, index): Scenario => ({
    name: index ? 'garden-afternoon-rotated' : 'garden-afternoon',
    title: index ? 'Garden afternoon · rotated intentions (hypothetical)' : 'Garden afternoon · plant, break, care and read (hypothetical)',
    description: 'Start garden afternoon, then Play. A gardener plants from the same finite seed bowl, takes an ordinary courtyard break and waters the same bed. An independent reader begins a book, walks separately and returns to the same unfinished bookmark. Pause, direct, Resume or End each person independently; safe cleanup retains actual bowls, deposits and intentions. Two authored ground layouts; no shared-walk synchronization, growth, refill or active reload restoration.',
    scene: gardenAfternoonScene, humans: () => [], build: () => gardenAfternoonRuntime(yaw),
    start: () => {}, continuous: true, maxTicks: 36000, focus: [2, 2, 18, 65], expect: checks,
  })),
  ...[0, Math.PI / 2].map((yaw, index): Scenario => ({
    name: index ? 'seed-planting-rotated' : 'seed-planting',
    title: index ? 'Seed planting · rotated beds (hypothetical)' : 'Seed planting · finite material and retained purpose (hypothetical)',
    description: 'Start planting one bed, then Play. Carry the same finite seed bowl, deposit material into supported soil and return the bowl. Pause or direct the planter away safely; explicitly continue the same partial purpose. Complete A then B from the remaining seeds. Planted material remains after End; no growth, refill, replacement actor or active reload restoration.',
    scene: seedPlantingScene, humans: () => [], build: () => seedPlantingRuntime(yaw),
    start: () => {}, continuous: true, maxTicks: 36000, focus: [0, 0, 10, 70], expect: checks,
  })),
  ...[0, Math.PI / 2].map((yaw, index): Scenario => ({
    name: index ? 'reading-circle-rotated' : 'reading-circle', title: index ? 'Shared reading · rotated circle (hypothetical)' : 'Shared reading · book and questions (hypothetical)',
    description: 'Start shared reading, then Play. One reader advances the same supported book while declared listeners occupy real places; interval questions and answers retain the actual page and bookmark. Pause/Resume, Join/Leave or direct the reader away; explicit continuation retains the same reader and book. End preserves unfinished progress for an explicit new circle. Authored ground-table arrangements, no reader handoff, speech generation or active reload restoration.',
    scene: readingCircleScene, humans: () => [], build: () => readingCircleRuntime(yaw),
    start: () => {}, continuous: true, maxTicks: 36000, focus: [0, -0.5, 4, 110], expect: checks,
  })),
  ...['gallery-tour', 'gallery-tour-short'].map((name): Scenario => ({
    name, title: name === 'gallery-tour-short' ? 'Guided gallery · two stops (hypothetical)' : 'Guided gallery · three stops (hypothetical)',
    description: 'Start gallery tour, then Play. Walk between actual pre-made drawing fixtures, form viewing circles and exchange questions. Pause/Resume, Join/Leave or direct the host away. Each new stop needs the host and two viewers; departures persist, with explicit late Join or End when attendance is insufficient. Same artwork and completed discussion history remain. Authored flat-ground gallery; no arbitrary exhibitions or active reload restoration.',
    scene: galleryTourScene, humans: () => [], build: galleryTourRuntime,
    start: () => {}, continuous: true, maxTicks: 36000, focus: [0, 1, 22, 55], expect: checks,
  })),
  ...[0, Math.PI / 2].map((yaw, index): Scenario => ({
    name: index ? 'table-cleanup-rotated' : 'table-cleanup', title: index ? 'Table cleanup · rotated setup (hypothetical)' : 'Table cleanup · same bowls and book (hypothetical)',
    description: 'Start cleanup, then Play. One person physically carries three existing bowls/books between declared table slots; their identities and contents remain. Pause returns the held item safely; Resume keeps completed placements. Direct the tidier away or End. No deletion, washing, arbitrary storage planning or unsupported ground drops.',
    scene: tidyTableScene, humans: () => [], build: () => tidyTableRuntime(yaw),
    start: () => {}, continuous: true, maxTicks: 36000, focus: [0, 0, 10, 65], expect: checks,
  })),
  {
    name: 'creative-afternoon', title: 'Creative afternoon · make, share, return (hypothetical)',
    description: 'Start creative afternoon, then Play. The artist makes three actual marks, shares that same pad, joins a two-performer music exchange, then returns to finish the same shelter study. A reader and gardener keep independent commitments. Pause/resume one person, ask about the drawing, invite a late visitor or direct someone away. Fixed ground layout; no active reload restoration.',
    scene: creativeAfternoonScene, humans: () => [], build: creativeAfternoonRuntime,
    start: () => {}, tick: tickCreativeAfternoon, continuous: true, maxTicks: 36000, focus: [0, 0, 22, 65], expect: checks,
  },
  {
    name: 'art-sharing', title: 'Art sharing · questions around a retained drawing (hypothetical)',
    description: 'Start sharing, then Play. A host and two visitors physically gather around a clearly labelled pre-made drawing fixture. Ask questions, change the floor, invite a late visitor, leave, pause or resume. The connected creative-afternoon preset makes its actual artwork first. Grounded tabletop viewing places only.',
    scene: artSharingScene, humans: () => [], build: artSharingRuntime,
    start: () => {}, continuous: true, maxTicks: 36000, focus: [0, 0, 8, 65], expect: checks,
  },
  {
    name: 'drawing-work', title: 'Drawing Klerb-inspired sketching (hypothetical)',
    description: 'Start drawing, then Play. A real pencil makes retained marks on the same supported pad. Pause or direct the sketcher away, then Resume the unfinished study. One bounded standing/tabletop outline; no arbitrary art tools.',
    scene: drawingWorkScene, humans: () => [], build: drawingWorkRuntime,
    start: () => {}, continuous: true, maxTicks: 36000, focus: [0, 0, 5, 70], expect: checks,
  },
  {
    name: 'group-warmup', title: 'Guided standing warm-up (hypothetical)',
    description: 'Start a guide and four staggered followers on a clear floor. Play watches planted settle/raise/open/lower phases, independent response delay and shared attention. Join/Leave, Pause/Resume and player direction retain coherent timing. Not a historical yoga reconstruction.',
    scene: () => READING_SCENE, humans: () => [], build: () => groupWarmupRuntime(),
    start: () => {}, continuous: true, maxTicks: 36000, focus: [0, 0, 9, 60], expect: checks,
  },
  {
    name: 'open-jam', title: 'Open jam · performer exchange (hypothetical)',
    description: 'Start a two-performer digital sound exchange at the same computer. Play watches real chair release and physical handoff; pause/resume a retained round or direct its performer away. Original scores and completed rounds remain distinct; no acoustic instrument simulation.',
    scene: () => READING_SCENE, humans: () => [], build: () => openJamRuntime(),
    start: () => {}, continuous: true, maxTicks: 36000, focus: [-1, 0, 10, 65], expect: checks,
  },
  {
    name: 'garden-care',
    title: 'Garden care · finite water (hypothetical)',
    description:
      'Choose either planter and request care. Play watches approach, actual water deposits and return of the same bowl. Pause safely, resume retained deposits or direct the carer elsewhere. Two cycles per planter exhaust the finite supply; no growth or automatic refill.',
    scene: gardenCareScene,
    humans: () => [],
    build: () => {
      const w = gardenCareWorld();
      return new Runtime(
        w,
        createRegistry(),
        servicesFor({ [w.base.campus]: gardenCareScene() })(w),
        ENGINE_INVARIANTS,
      );
    },
    start: () => {},
    continuous: true,
    maxTicks: 36000,
    focus: [0, 0, 10, 70],
    expect: checks,
  },
  {
    name: 'music-dance',
    title: 'Music and grounded dancing (hypothetical)',
    description:
      'Start the gathering, invite a late dancer, withdraw individual participants, pause and resume the same digital score. Planted-foot dance gestures use reserved clear floor positions. No locomoting dance, imported music or arbitrary choreography.',
    scene: () => READING_SCENE,
    humans: () => [],
    build: () => musicGatheringRuntime(),
    start: () => {},
    continuous: true,
    maxTicks: 36000,
    focus: [-1, 0, 10, 65],
    expect: checks,
  },
];
