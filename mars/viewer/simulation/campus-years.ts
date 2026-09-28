// Generated historical campus scenes (public/engine/campus-<year>.json, deploy/history-scenes.mjs),
// bundled into the Worker so a year room's engine seeds canonical `mars-<year>` without a fetch.
import type { CampusYearFile } from '../engine/campus/history.ts';
import y2020 from '../public/engine/campus-2020.json';
import y2021 from '../public/engine/campus-2021.json';
import y2022 from '../public/engine/campus-2022.json';
import y2023 from '../public/engine/campus-2023.json';
import y2024 from '../public/engine/campus-2024.json';
import y2025 from '../public/engine/campus-2025.json';

const FILES: Record<number, unknown> = { 2020: y2020, 2021: y2021, 2022: y2022, 2023: y2023, 2024: y2024, 2025: y2025 };

export function campusYearFile(year: number): CampusYearFile | undefined {
  return FILES[year] as CampusYearFile | undefined;
}
