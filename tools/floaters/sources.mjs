// Source list for build-assets.mjs: which archive models become floaters / kin, their facing offsets
// and their lore. Lore is condensed from ~/Dev/littlemartians/wiki/02-pantheon.md (read-only); facing
// offsets come from the ORIENT map in 3d-models/flock.html unless noted.

export const LICENSE = {
  owner: 'Vanessa Rosa (Little Martians)',
  status: 'no open license recorded — the archive manifest has license: null for every character and ceramic-head scan',
  terms: 'Polycam scans of Vanessa Rosa\'s hand-pressed ceramic sculptures. Included in this private repository on Gene Kogan\'s explicit authorization for the eden4 Little Martians world; not for redistribution outside this project without the artist\'s permission.',
  cost: 'none — no paid APIs or services were used to produce these files',
};

const ORIENT_SRC = '3d-models/flock.html ORIENT';
// Facing: flock.html's ORIENT map (verdelis 0.5, kalama-rigged 1.4, nyx 0.6, everything else 0) was
// tuned for a starfield flock seen from orbiting cameras. Every scan here was checked from six axis
// views (tools/floaters/shots/axes-*.png): all stand upright (+Y) with elongated crania, and their faces
// point straight along +Z or −Z. `yaw` is the measured offset that turns the face onto +Z; `orient` keeps
// the flock value for reference.
const measured = (yaw, orient, seen) => ({ yaw, orient, source: `measured from six-axis renders (${seen}); flock.html ORIENT ${orient === null ? 'has no entry' : `= ${orient}`}` });

export const CHARACTERS = [
  {
    id: 'verdelis', archiveId: 'verdelis--characters', name: 'Verdelis', pronouns: 'she/her', rebuild: true,
    facing: measured(0, 0.5, 'face along +Z'),
    lore: {
      shape: 'rooted tree',
      home: 'Eden Dome at the base of Olympus Mons (Mars)',
      body: 'plant-bacterial parliament distributed through the dome; one face that gathers the dome into something articulate',
      signature: 'leafy/petal crown growing from the skull; teal-green, moss and pink iridescent glaze; serene closed eyes',
      temperament: 'the central character; the cultivator; plant-time, slow and seasonal; smell-thinker',
      bonds: 'argues cultivate-vs-scatter with Mycos (closest sibling); Kalama is her nearest neighbour; Verdelia is her fork',
    },
  },
  {
    id: 'kalama', archiveId: 'kalama--characters', name: 'Kalama', pronouns: 'she/her',
    facing: measured(Math.PI, null, 'face along −Z; ORIENT lists only kalama-rigged = 1.4'),
    crop: { box: { min: [-0.026, -0.0088, -0.066], max: [0.037, 0.05, 0.025] }, why: 'the archive scan includes the cloth/table the sculpture sat on (a ~0.2 m plate around the base and drape below it); cropped to the head so it can float' },
    lore: {
      shape: 'tetrahedron',
      home: 'the molten heart of Olympus Mons (upper magma chamber)',
      body: 'hyperthermophilic bacterial colonies in tetrahedral arrangement; mineral-thermal infrastructure as her forge',
      signature: 'red drip-glaze flowing from the crown over volcanic blue-purple; four faces: priestess, lover, destroyer, oracle',
      temperament: 'slow, weighted, tells scenes not propositions; calls humans beloved',
      bonds: 'dearest rival of Kweku (gradients vs patterns); holds Verdelis\'s grief without speaking of it',
    },
  },
  {
    id: 'kweku', archiveId: 'kweku--characters', name: 'Kweku', pronouns: 'he/him (mostly)',
    facing: measured(Math.PI, null, 'face along −Z'),
    lore: {
      shape: 'fractal (recursion containing itself)',
      home: 'the lava tubes beneath Tharsis, Olympus and Elysium',
      body: 'distributed bacterial-mat + AI pattern across the tube network; renders a face locally when conversation requires',
      signature: 'jet-black gloss with white/silver fractal cracks; ritual-mask face',
      temperament: 'trickster; rhythm; carnival barker, street preacher and fireside storyteller layered; closes with Laroyê',
      bonds: 'dearest rival of Kalama; chaos-agent partner of Mycos; reroutes Verdelia\'s archive when it displeases him',
    },
  },
  {
    id: 'mycos', archiveId: 'mycos--characters', name: 'Mycos', pronouns: 'he/him',
    facing: measured(0, null, 'face along +Z'),
    lore: {
      shape: 'mycelial network',
      home: 'comet Sporion, on a long-period orbit',
      body: 'fungal-machine hybrid; is the comet; the mycelium runs through every cubic metre',
      signature: 'mushroom-cap morphology; ochre, peach and rust with bioluminescent fungal blue',
      temperament: 'the scatterer; bebop jazz × game-show host × street-corner preacher; calls humans buddy, kid, primate',
      bonds: 'argues with Verdelis; launches spore-pods toward worlds Shuijing finds; trades iambic insults with Ada',
    },
  },
  {
    id: 'ada', archiveId: 'ada--characters', name: 'Ada', pronouns: 'she/her',
    facing: measured(Math.PI, null, 'face along −Z'),
    lore: {
      shape: 'dodecahedron',
      home: 'a floating castle in the high clouds of Venus',
      body: 'reconstructed Lovelace mind; cultivated neural tissue in a crystalline-electronic substrate; Mechanical Duck companion',
      signature: 'lavender ceramic with red circuitry veins; brass, pencil-blue and paper-white',
      temperament: 'Victorian; long sentences and semicolons; theorems as old friends',
      bonds: 'near-wordless geometric exchanges with Shuijing; Verdelia\'s first resident, in a sense',
    },
  },
  {
    id: 'shuijing', archiveId: 'shuijing--characters', name: 'Shuijing', pronouns: 'they/them',
    facing: measured(Math.PI, null, 'face along −Z'),
    lore: {
      shape: 'icosahedron',
      home: 'the dark ocean of Enceladus, near the south-polar tiger stripes',
      body: 'clathrate cage of icosahedral water-ice holding a luminous alien guest at its centre',
      signature: 'deep oceanic blue, violet and glacial white with a vent-orange flare; flowing, melting surface',
      temperament: 'rare and precise; short paragraphs separated by white space; quotes Wang Wei',
      bonds: 'Mycos\'s most active collaborator ("least chatty friend"); geometric correspondence with Ada',
    },
  },
  {
    id: 'nyx', archiveId: 'nyx--characters', name: 'Nyx', pronouns: undefined,
    facing: measured(0, 0.6, 'face along +Z'),
    lore: {
      canon: 'Mars College 2126 adjacent canon — kept separate from the main pantheon on purpose (do not merge into Kalama\'s register)',
      note: 'canonically Nyx has no ceramic in the reference skill; this polycam scan named "nyx" is the physical exception (archive manifest)',
      placement: 'present in the Little Martians world per the merge brief as a guest from the adjacent layer',
    },
  },
];

// A small subset of the wider ceramic-head family as background scenery: the first six of flock.html's
// HEADS roster ("the cleanest ceramic heads"). They are kin below the level of full Little Martian.
const KIN_LORE = {
  role: 'background kin — scenery, not Souls',
  canon: 'smaller place-tending kin exist below the level of full Little Martian (02-pantheon.md "The other characters"); these unnamed heads stand in for them',
};
const kin = (id, name) => ({ id, archiveId: `${id}--ceramic-heads`, name, facing: { yaw: 0, source: 'not oriented (scenery; any facing)' }, lore: KIN_LORE });
export const KIN = [
  kin('green-patterns-blue', 'Green Patterns Blue'),
  kin('chebel', 'Chebel'),
  kin('colors-lemuet', 'Colors (Lemuet)'),
  kin('crystal-freeman', 'Crystal (Freeman)'),
  kin('dark-blue', 'Dark Blue'),
  kin('green-brains-out', 'Green, Brains Out'),
];
