import { INTERIOR_2026_VIEWS } from '../history/interior-2026-views';

/** Reviewed inspection cameras, not a certificate of walkable interior support.
 * Source: historical owner's integration-release-20261001/REVIEWED_INTERIOR_VIEWS.json. */
type RoomView = {
  label: string;
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  provenance?: string;
};
export const PRESENTATION_ROOMS: Record<number, Record<string, RoomView>> = {
  '2020': {
    'portal-screen-interior': {
      label: 'Portal',
      position: [-9, 1.8, 5],
      target: [-9, 1.6, -3],
      provenance: 'year-2020/reconciliation-20261001/CAMERAS.json',
      fov: 61,
    },
  },
  '2021': {
    '2021-library': {
      label: 'Library',
      position: [-1.35, 1.75, -2],
      target: [-4.572, 1.1, -6],
      provenance: 'year-2021/reconciliation-20261001/CAMERAS.json',
      fov: 61,
    },
    '2021-cowork': {
      label: 'Cowork',
      position: [-1.35, 1.72, 7],
      target: [-4.572, 0.8, 5.35],
      provenance: 'year-2021/reconciliation-20261001/CAMERAS.json',
      fov: 61,
    },
    '2021-seminar': {
      label: 'Seminar',
      position: [0.75, 1.55, 4],
      target: [4.572, 1.1, 1],
      provenance: 'year-2021/reconciliation-20261001/CAMERAS.json',
      fov: 61,
    },
  },
  '2022': {
    '2022-BSS-study': {
      label: 'Study/library',
      position: [1.62, 1.7, -8.8],
      target: [2.3, 1.3, -12.4],
      provenance: 'year-2022/reconciliation-20261001/runtime-views.json',
      fov: 61,
    },
    '2022-Cahuilla-sink-room': {
      label: 'Cahuilla kitchen',
      position: [9.2, 1.8, 2.23],
      target: [12.2, 1.3, 1.5],
      provenance: 'year-2022/reconciliation-20261001/runtime-views.json',
      fov: 61,
    },
    '2022-Chatsubo-bar': {
      label: 'Chatsubo',
      position: [-2.6, 1.8, 8.5],
      target: [-2.6, 1.3, 11.8],
      provenance: 'year-2022/reconciliation-20261001/runtime-views.json',
      fov: 61,
    },
    '2022-HQB-upper-room': {
      label: 'Huaqiangbei upper room',
      position: [-9.3, 3.95, -2.62],
      target: [-12.8, 3.15, -2.62],
      provenance: 'year-2022/reconciliation-20261001/runtime-views.json',
      fov: 61,
    },
  },
  '2023': {
    '2023-classroom': {
      label: 'Chiba classroom',
      position: [7.3, 1.7, 2.3],
      target: [7.3, 1.3, -2.6],
      provenance: 'year-2023/reconciliation-20261001/runtime-views.json',
      fov: 61,
    },
    '2023-media-room': {
      label: 'Chiba media room',
      position: [3.65, 1.65, 1.25],
      target: [3.65, 1.35, -3.1],
      provenance: 'year-2023/reconciliation-20261001/runtime-views.json',
      fov: 61,
    },
    '2023-rotapolis-kitchen': {
      label: 'Rotapolis kitchen',
      position: [10.2, 1.9, -32.3],
      target: [9.6, 1.25, -34.9],
      provenance: 'year-2023/reconciliation-20261001/runtime-views.json',
      fov: 61,
    },
  },
  '2024': {
    'chiba-auditorium': {
      label: 'Chiba auditorium',
      position: [-1.829, 1.65, 4.2],
      target: [-1.829, 1.9, -1.9],
      provenance: 'year-2024/LIVE_VIEWS_A_20261001.json',
      fov: 61,
    },
    'chiba-occupied-gallery': {
      label: 'Chiba gallery',
      position: [-5.4, 3.95, 3.8],
      target: [-8.55, 3.7, -1.2],
      provenance: 'year-2024/LIVE_VIEWS_A_20261001.json',
      fov: 61,
    },
    'chiba-dojo-native-cloth': {
      label: 'Chiba dojo',
      position: [9.14, 3.6, -1.4],
      target: [9.14, 3.55, -5.38],
      provenance: 'year-2024/LIVE_VIEWS_A_20261001.json',
      fov: 61,
    },
    'chiba-solarium-settled': {
      label: 'Chiba solarium',
      position: [7.2, 1.55, 6.9],
      target: [9.2, 0.8, 4.6],
      provenance: 'year-2024/root-combined-20261001/occupied-solarium.png',
      fov: 61,
    },
  },
  '2025': {
    'chiba-inner-north': {
      label: 'Chiba',
      position: [0, 3.9, 4.0],
      target: [0, 2.0, -3.8],
      provenance: 'year-2025/VIEW_CAMERAS_A_20261001.json',
      fov: 62,
    },
    'libaby-occupied': {
      label: 'Libaby',
      position: [-21.15, 1.65, 16.7],
      target: [-20.2, 1.2, 20.1],
      provenance: 'year-2025/VIEW_CAMERAS_A_20261001.json',
      fov: 72,
    },
    'freeside-central-rear': {
      label: 'Freeside living room',
      position: [-17.05, 1.55, 19.2],
      target: [-17.9, 1.55, 15.6],
      provenance: 'year-2025/VIEW_CAMERAS_A_20261001.json',
      fov: 65,
    },
    'freeside-kitchen': {
      label: 'Freeside kitchen',
      position: [-13.65, 1.75, 20.2],
      target: [-13.75, 1.35, 16.0],
      provenance: 'year-2025/VIEW_CAMERAS_A_20261001.json',
      fov: 72,
    },
    'bodywork-final-clear-interior': {
      label: 'Bodywork',
      position: [24, 1.8, 10],
      target: [22.4, 1.4, 3.7],
      provenance:
        'year-2025/VIEW_RETRY_A_20261001.json;combined-final actualPNG',
      fov: 73,
    },
  },
  2026: INTERIOR_2026_VIEWS,
};
