import { useId, useState } from 'react';
import './presentation.css';

type PresentationControlsProps = {
  year: number;
  walking: boolean;
  cycle: boolean;
  hour: number;
  rooms: { id: string; label: string }[];
  onYear: (year: number) => void;
  onWalk: () => void;
  onRoom: (id: string) => void;
  onCycle: (cycle: boolean) => void;
  onHour: (hour: number) => void;
  onRide: () => void;
};

function clockLabel(hour: number) {
  const minutes = Math.min(1439, Math.max(0, Math.round(hour * 60)));
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function PresentationControls({
  year,
  walking,
  cycle,
  hour,
  rooms,
  onYear,
  onWalk,
  onRoom,
  onCycle,
  onHour,
  onRide,
}: PresentationControlsProps) {
  const [open, setOpen] = useState(true);
  const panelId = useId();
  const hourId = useId();
  const clock = clockLabel(hour);

  return (
    <aside className="presentation-controls" aria-label="Campus controls">
      <button
        type="button"
        className="presentation-controls-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        Controls <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      <div id={panelId} className="presentation-controls-body" hidden={!open}>
        <label className="presentation-control-row">
          <span>Year</span>
          <select
            aria-label="Year"
            value={year}
            onChange={(event) => onYear(Number(event.target.value))}
          >
            {[2020, 2021, 2022, 2023, 2024, 2025, 2026].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <div
          className="presentation-mode"
          role="group"
          aria-label="Camera mode"
        >
          <button
            type="button"
            aria-pressed={!walking}
            onClick={() => {
              if (walking) onWalk();
            }}
          >
            Aerial
          </button>
          <button
            type="button"
            aria-pressed={walking}
            onClick={() => {
              if (!walking) onWalk();
            }}
          >
            WASD
          </button>
        </div>
        <label className="presentation-control-row">
          <span>Go inside</span>
          <select
            aria-label="Go inside"
            value=""
            disabled={rooms.length === 0}
            onChange={(event) => {
              if (event.target.value) onRoom(event.target.value);
            }}
          >
            <option value="">
              {rooms.length ? 'Choose room' : 'No rooms available'}
            </option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.label}
              </option>
            ))}
          </select>
        </label>
        <label className="presentation-time-toggle">
          <input
            type="checkbox"
            checked={cycle}
            onChange={(event) => onCycle(event.target.checked)}
          />
          <span>Time</span>
        </label>
        <div className="presentation-hour">
          <label htmlFor={hourId}>Time of day</label>
          <output htmlFor={hourId}>{clock}</output>
          <input
            id={hourId}
            type="range"
            min="0"
            max="23.99"
            step="0.01"
            value={hour}
            aria-valuetext={clock}
            onChange={(event) => onHour(Number(event.target.value))}
          />
        </div>
        <button type="button" className="presentation-ride" onClick={onRide}>
          ride EUC
        </button>
      </div>
    </aside>
  );
}
