// Mars 2026 beyond the edge, as data for core/far-land@1 and core/panorama@1 (lane MARSLAND-FAR).
// Campus frame: origin = campus centre (Chiba), x = east, z = south (north = -z), metres, ±10%.
// Sources: the 2026 drone video frames (team/lanes/marsland-frames) and Google Maps (team/lanes/mars-land-refs).
export const MARS_FAR_LAND = {
  radius: 2300,
  areas: [
    // white salt flats with orange-brown patches from the levee band to the shore (the sea covers its south part)
    { pts: [[-2700, 815], [-1500, 812], [0, 806], [1500, 818], [3200, 830], [3200, 2300], [-2700, 2300]], m: 'salt', edge: 25 },
    // the vegetated delta fan where the wash reaches the sea
    { pts: [[1000, 950], [1450, 860], [1900, 900], [2250, 1080], [2350, 1500], [2200, 1950], [1700, 2050], [1250, 1950], [1020, 1550]], m: 'delta', edge: 60, shrubs: 45 },
  ],
  strips: [
    // the levee / scrub band E–W south of camp, two pale tracks along it
    { pts: [[-2600, 785], [-1500, 780], [0, 776], [1500, 790], [3000, 802], [3300, 806]], w: 80, m: 'scrub', tracks: [-16, 18], trackW: 4, shrubs: 40 },
    // the big wash: main braided channel from the NNE down to the delta, and a second channel from the NE
    { pts: [[59, -2348], [354, -1640], [531, -1227], [885, -578], [1239, 12], [1534, 425], [1711, 779], [1850, 1100], [1950, 1500]], w: 110, m: 'wash', shrubs: 55 },
    { pts: [[3481, -2348], [2773, -1168], [2183, 130], [1947, 602], [1900, 900]], w: 80, m: 'wash', shrubs: 45 },
  ],
  roads: [
    // Highway 111, poles on its SE side
    { pts: [[-2773, 779], [-1947, 543], [-1357, 248], [-826, -165], [-295, -578], [177, -991], [413, -1257], [708, -1463], [1298, -1611], [1888, -1611], [2478, -1404], [2950, -1168], [3540, -932]], w: 12, poles: { side: 1, every: 60, h: 10 } },
  ],
  sea: { pts: [[-2800, 1640], [-1500, 1660], [-600, 1720], [0, 1780], [900, 1880], [1800, 2000], [2600, 2060], [3600, 2120], [3600, 30000], [-30000, 30000], [-30000, 1640]], level: -1.2, c: '#4f8db5', beach: 55 },
};
export const MARS_PANORAMA = {
  haze: '#9fbdd8',
  visibility: 90000,
  water: { from: 104, to: 262, c: '#5b98c2', far: '#a3c4da' },
  ranges: [
    // S–SE: far low faint hills across the sea
    { from: 118, to: 205, d: 52000, h: 950, rough: 0.4, c: '#6f8fae', haze: 1.1, foothills: 0, profile: [0.3, 0.6, 0.45, 0.8, 0.5, 0.35, 0.6, 0.3] },
    // W–SW across the sea: the Santa Rosa Mountains, blue and hazy
    { from: 226, to: 294, d: 40000, h: 2300, rough: 0.55, c: '#3b5f8c', haze: 0.9, foothills: 0.3, profile: [0.25, 0.5, 0.75, 0.95, 0.85, 1.0, 0.8, 0.6, 0.45, 0.3] },
    // NW: bluish ranges far up the valley
    { from: 286, to: 352, d: 33000, h: 1600, rough: 0.55, c: '#2f4f7c', haze: 0.85, foothills: 0.3, profile: [0.35, 0.6, 0.9, 1.0, 0.75, 0.85, 0.6, 0.4] },
    // N–NE: the red/purple-banded Chocolate Mountains, nearest and highest to the NE
    { from: 340, to: 108, d: 10500, h: 760, rough: 0.7, c: '#6b4c4a', c2: '#9a5c46', bands: 0.5, haze: 0.75, foothills: 0.7, profile: [0.35, 0.45, 0.55, 0.62, 0.8, 0.95, 1.0, 0.9, 0.8, 0.7, 0.55, 0.42, 0.3] },
  ],
};
