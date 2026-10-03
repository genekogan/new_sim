// Generated historical scenes and the 2026 CAD reconstruction from public/engine/campus-<year>.json,
// bundled into the Worker so a year room's engine seeds canonical `mars-<year>` without a fetch.
import type { RoomCampusFile } from '../engine/api/seeds.ts';
import y2020 from '../public/engine/campus-2020.json';
import y2021 from '../public/engine/campus-2021.json';
import y2022 from '../public/engine/campus-2022.json';
import y2023 from '../public/engine/campus-2023.json';
import y2024 from '../public/engine/campus-2024.json';
import y2025 from '../public/engine/campus-2025.json';
import y2026 from '../public/engine/campus-2026.json';

const FILES: Record<number, unknown> = { 2020: y2020, 2021: y2021, 2022: y2022, 2023: y2023, 2024: y2024, 2025: y2025, 2026: y2026 };

export function campusYearFile(year: number): RoomCampusFile | undefined {
  return FILES[year] as RoomCampusFile | undefined;
}
