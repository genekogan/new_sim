// Plain authored bindings for the same live controls; never another executor.
import { classroomParams } from '../../engine/scenarios/classroom.ts';
import { WORK_BREAK_BINDING } from '../../engine/scenarios/work-break.ts';
import { designStudioBindings, type DesignStudioBindings } from '../../engine/scenarios/design-studio.ts';
import { classroomFurniture } from './room-layout.ts';

export function activityExample(scenario: string): DesignStudioBindings | undefined {
  if (scenario === 'design-studio') return designStudioBindings();
  if (scenario !== 'work-break-4' && scenario !== 'work-break-8') return undefined;
  const count = scenario === 'work-break-8' ? 8 : 4;
  const session = classroomParams(count);
  return {
    roles: { host: session.host, presenters: ['presenter1', 'presenter2'], audience: session.audience, worker: 'worker', companion: 'visitor' },
    workBreak: structuredClone(WORK_BREAK_BINDING), session,
    rest: { seat: `${classroomFurniture(scenario).chair.id}#seat`, seconds: 5 }, departure: [10, 12],
    followUpWork: { kind: 'work', actor: 'presenter1', work: { station: WORK_BREAK_BINDING.work.station, seat: WORK_BREAK_BINDING.work.seat, task: 'Record talk follow-up', duration: 12 } },
    followUpDiscussion: { kind: 'discussion', actors: ['guest1', 'guest2'], at: [-7, 6], duration: 20 },
  };
}
