// Mars 2026 beyond the edge, as data for core/far-land@1 and core/panorama@1 (lane MARSLAND-FAR).
// Campus frame: origin = campus centre (Chiba), x = east, z = south (north = -z), metres, ±10%.
// Sources: the 2026 drone video frames (team/lanes/marsland-frames) and Google Maps (team/lanes/mars-land-refs).
export const MARS_FAR_LAND = {
  radius: 2300,
  areas: [
    // the salt-pan mosaic from the levee band to the shore: pale crusts, orange-brown flats, dark shrub patches (the sea covers its south part)
    { pts: [[-2700, 815], [-1500, 812], [0, 806], [1500, 818], [3200, 830], [3200, 2300], [-2700, 2300]], m: 'flats', edge: 25, shrubs: 30 },
    // the vegetated delta fan where the wash reaches the sea
    { pts: [[1000, 950], [1450, 860], [1900, 900], [2250, 1080], [2350, 1500], [2200, 1950], [1700, 2050], [1250, 1950], [1020, 1550]], m: 'delta', edge: 60, shrubs: 45 },
  ],
  strips: [
    // the levee / scrub band E–W south of camp, two pale tracks along it
    { pts: [[-2600, 785], [-1500, 780], [0, 776], [1500, 790], [3000, 802], [3300, 806]], w: 90, m: 'scrub', tracks: [-18, 20], trackW: 3, shrubs: 45 },
    // the big wash: main braided channel from the NNE down to the delta, and a second channel from the NE
    { pts: [[59, -2348], [354, -1640], [531, -1227], [885, -578], [1239, 12], [1534, 425], [1711, 779], [1850, 1100], [1950, 1500]], w: 110, m: 'wash', shrubs: 55 },
    { pts: [[3481, -2348], [2773, -1168], [2183, 130], [1947, 602], [1900, 900]], w: 80, m: 'wash', shrubs: 45 },
  ],
  roads: [
    // Highway 111, poles on its SE side
    // (re-read from the zoomed-out map, campus at px (530, 398), 5.9 m/px: the west half runs ~150–250 m further north than
    // the first estimate, which also matches frame f_080, where the road leaves the picture on the left)
    { pts: [[-3127, 767], [-2540, 600], [-1947, 425], [-1357, 41], [-767, -372], [-177, -755], [177, -1000], [413, -1286], [708, -1470], [1357, -1600], [1888, -1560], [2478, -1404], [2773, -1286], [3540, -991]], w: 12, poles: { side: 1, every: 60, h: 10 } },
  ],
  sea: { pts: [[-2800, 1640], [-1500, 1660], [-600, 1720], [0, 1780], [900, 1880], [1800, 2000], [2600, 2060], [3600, 2120], [3600, 30000], [-30000, 30000], [-30000, 1640]], level: -1.2, c: '#4f9fd6', beach: 160 },
};
export const MARS_PANORAMA = {
  haze: '#9fbdd8',
  visibility: 90000,
  water: { from: 104, to: 262, c: '#5b98c2', far: '#a3c4da' },
  ranges: [
    // S across the sea: a faint far hill or two (most of the southern horizon is open water)
    { from: 150, to: 178, d: 60000, h: 700, rough: 0.3, c: '#7f9cb8', haze: 1.1, foothills: 0, profile: [0.1, 0.5, 1.0, 0.6, 0.2] },
    // W–WNW across the sea and the valley: the Santa Rosa Mountains, blue and hazy, broad, ~2–2.5° (f_045)
    { from: 228, to: 306, d: 40000, h: 1900, rough: 0.25, c: '#2d5a8c', haze: 0.8, foothills: 0.3, profile: [0.15, 0.35, 0.55, 0.75, 0.9, 1.0, 0.85, 0.95, 0.8, 0.6, 0.4, 0.2] },
    // NW: the open Coachella valley — only very far, faint ranges low on the horizon (f_001)
    { from: 300, to: 334, d: 90000, h: 1500, rough: 0.3, c: '#6f8db0', haze: 1.0, foothills: 0, profile: [0.3, 0.6, 0.45, 0.7, 0.5, 0.3] },
    // N–NNW: bluish hills up the valley side (Mecca Hills, Orocopia), ~2–3° (f_001 right, f_040 left, f_080 left)
    { from: 326, to: 14, d: 22000, h: 1150, rough: 0.3, c: '#2e4a72', haze: 0.85, foothills: 0.35, profile: [0.2, 0.45, 0.7, 0.85, 1.0, 0.9, 0.8, 0.72, 0.62, 0.55] },
    // N–NE: the red/purple-banded Chocolate Mountains, nearest and highest (~4°) to the NNE–NE, still high to the east
    { from: 348, to: 105, d: 11000, h: 800, rough: 0.4, c: '#5a4c5c', c2: '#8c5a4c', bands: 0.35, haze: 1.0, foothills: 0.7, profile: [0.5, 0.62, 0.8, 1.0, 0.95, 0.9, 0.85, 0.8, 0.7, 0.62, 0.55, 0.45, 0.35] },
  ],
};
