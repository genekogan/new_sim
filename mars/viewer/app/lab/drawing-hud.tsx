import { useState } from 'react';
import type { LabSim } from './sim.ts';
import { drawingWorkParams } from '../../engine/scenarios/drawing-work.ts';
import { readDrawing } from '../../engine/objects/drawing.ts';
export function DrawingHud({
  sim,
  refresh,
}: {
  sim: LabSim;
  refresh: () => void;
}) {
  const [feedback, setFeedback] = useState(
    'Start drawing, then Play to watch the same pencil make retained marks.',
  );
  if (sim.scenario.name !== 'drawing-work') return null;
  const rt = sim.rt,
    state = readDrawing(rt, 'sketch-pad'),
    valid = !('code' in state),
    rec = [...rt.records.values()]
      .filter((r) => r.verb === 'drawing_work')
      .at(-1),
    active = !!rec && rt.isActive(rec.id);
  const begin = (resume: boolean) => {
    const r = rt.submit('drawing_work', {
      ...drawingWorkParams(),
      ...(resume ? { resume: true } : {}),
    });
    setFeedback(
      r.diagnostic
        ? `${r.diagnostic.code}: ${r.diagnostic.message}`
        : resume
          ? 'Continuing the same partial stroke and pad.'
          : 'Taking the actual pencil from the table.',
    );
    refresh();
  };
  return (
    <section className="lab-hud lab-classroom" data-testid="drawing-hud">
      <h3>Drawing · retained shelter study</h3>
      <p>
        Hypothetical low-pressure sketching inspired by Drawing Klerb. A
        standing sketcher takes a real pencil, makes eight visible marks on the
        same pad, and returns the pencil. The bounded study is a generic shelter
        outline, not a reconstructed Mars artifact.
      </p>
      <div data-testid="drawing-readout">
        {valid
          ? `${state.status} · ${state.completedMarks.length}/${state.totalMarks} marks · ${(state.progress * 100).toFixed(0)}% · ${state.phase || 'ready'}`
          : `${state.code}: ${state.message}`}
      </div>
      <div className="lab-classroom-controls">
        <button
          disabled={active || (valid && state.status !== 'idle')}
          onClick={() => begin(false)}
        >
          Start drawing
        </button>
        <button
          disabled={!active}
          onClick={() => {
            rt.cancel(rec!.id);
            setFeedback(
              'Withdrawing and returning the same pencil; committed marks stay on the pad.',
            );
            refresh();
          }}
        >
          Pause drawing
        </button>
        <button
          disabled={active || !valid || state.status !== 'unfinished'}
          onClick={() => begin(true)}
        >
          Resume drawing
        </button>
        <button
          disabled={!active}
          onClick={() => {
            const r = rt.submit('walk_to', { actor: 'sketcher', x: -3, z: -3 });
            setFeedback(
              r.diagnostic
                ? `${r.diagnostic.code}: ${r.diagnostic.message}`
                : 'Safe pencil return precedes your walking direction. Resume explicitly returns to the study.',
            );
            refresh();
          }}
        >
          Direct sketcher away
        </button>
      </div>
      <p role="status">
        {valid && state.status === 'completed'
          ? 'Study complete. Artwork remains on the pad and the same pencil rests on the table.'
          : feedback}
      </p>
      <p>
        Supported scope: one grounded table and pad, standing right-hand
        drawing, one predefined study. Interruption retains exact partial marks.
        No erasing, arbitrary freehand input or active reload restoration.
      </p>
    </section>
  );
}
