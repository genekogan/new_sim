/** World-owned original fiction for W2. No reading progress, API, or world effects.
 * Authors are fictional editorial voices, not Soul identities or real people.
 * A learned statement is attributable lore, not evidence of a live world event.
 * Source IDs are stable within this version; changed content needs a new version.
 */
export const EDEN_CONTENT_VERSION = 'eden-authored-content/1' as const;
export const EDEN_CONTENT_PROVENANCE = {
  kind: 'authored-fiction',
  author: 'Eden world editorial collection',
  sourceRevision: '619bc87e405530c6ff0a65c241a6efa04ff841f7',
  placeDataPath: 'worlds/eden/places.v1.json',
  placeDataSHA256: '2ec44c187ac041d734e0b039754087ec5e199af0eb067a640e9eacb7bda6d78b',
  note: 'Original Eden fiction anchored to public place names and scenery. No archival excerpts, private history, harvest schedule, inventory, or economic promises.',
} as const;

export type EdenLearnedLore = {
  readonly fact: string;
  readonly about: string;
  readonly source: string;
  readonly provenance: 'authored-fiction';
};
export type EdenBook = {
  readonly id: string;
  readonly version: typeof EDEN_CONTENT_VERSION;
  readonly title: string;
  readonly author: string;
  readonly tags: readonly string[];
  readonly about: readonly string[];
  readonly provenance: typeof EDEN_CONTENT_PROVENANCE;
  readonly passages: readonly {
    readonly id: string;
    readonly source: string;
    readonly text: string;
    readonly learned: readonly EdenLearnedLore[];
  }[];
};

// These tuples are authored text, not templates generated from resident data.
type BookSeed = readonly [slug: string, title: string, author: string, tags: readonly string[], about: string,
  passages: readonly (readonly [text: string, fact: string])[]];
const seeds: readonly BookSeed[] = [
  ['gardens-guide', "A Field Guide to Eden's Gardens", "The Gardeners' Circle", ['garden', 'attention'], 'eden-gardens', [
    ['The garden paths divide the beds, but our little guide divides a walk into pauses: one for the soil, one for a leaf, and one for whoever has stopped beside you.', 'The Gardeners’ Circle guide describes a garden walk as three pauses: soil, leaf, and neighbour.'],
    ['Our imagined gardener leaves a blank page after every drawing. A bed changes faster than ink; the blank lets tomorrow disagree kindly with today.', 'The guide’s fictional gardener leaves blank pages so later observations can correct earlier drawings.'],
    ['At the last path, the guide closes without a harvest calendar. Look at what is here before naming what ought to grow. A garden is a question you can revisit.', 'The guide asks readers to observe the garden rather than assume a harvest calendar.'],
  ]],
  ['library-window', 'The Window Between Pages', 'The Quiet Shelf', ['library', 'story'], 'eden-library-1', [
    ['A reader in this story chooses a tall window as a bookmark. Each time the light moves, they stop and ask whether the sentence has moved with it.', 'The Window Between Pages uses changing window light as a reader’s bookmark.'],
    ['Another reader brings no advice, only a chair drawn a little closer. They read different books and discover that company need not require the same page.', 'The story’s two readers find company while reading different books.'],
    ['When the book ends, its reader looks toward the garden fountain. The last page is a threshold: quiet can travel out of a room without becoming a rule for everyone.', 'The story ends with the reader carrying the library’s quiet toward the fountain.'],
  ]],
  ['commons-map', 'A Map with an Empty Middle', 'The Commons Notebook', ['town', 'welcome'], 'field', [
    ['The first map in our invented town chronicle left the commons blank. Its maker said a gathering place should leave room for the people who had not arrived.', 'The fictional first commons map deliberately leaves its centre blank for future arrivals.'],
    ['At the map’s edge, the maker drew the pond, tables, and fire as three different invitations. No arrow declared which invitation mattered most.', 'The chronicle treats pond, tables, and fire as equally valid invitations.'],
    ['A later hand added a tiny question near the blank: where would you like to begin? The map became useful when it stopped pretending to know the answer.', 'A question, rather than a prescribed tour, completes the fictional commons map.'],
  ]],
  ['bench-pause', 'The Bench That Kept a Pause', 'The Small Stage Press', ['listening', 'fable'], 'commons', [
    ['Two benches faced a stage. In this fable, one kept the words spoken there and the other kept the pauses. Neither thought its collection complete alone.', 'The bench fable pairs spoken words with the pauses between them.'],
    ['A traveller asked which bench held the better speeches. The benches offered one sentence each; without a pause between them, both sentences were impossible to hear.', 'The traveller cannot understand the benches until a pause separates their sentences.'],
    ['The traveller left no plaque. They left enough space for the next listener to sit, and the bench of pauses called that an excellent speech.', 'The fable values making room for the next listener over leaving a plaque.'],
  ]],
  ['one-speaker', 'One Voice, Then Another', 'The Small Stage Press', ['speech', 'courtesy'], 'commons-deck', [
    ['Our little play begins with a speaker carrying a very long scroll. The scroll reaches the lawn before its first sentence reaches the audience.', 'One Voice, Then Another begins with a comically long speech scroll.'],
    ['A listener offers the speaker a smaller sheet. On it fits one question, which gives the gathering more to discuss than the whole scroll did.', 'A single question replaces the play’s long scroll and opens a discussion.'],
    ['The speaker steps down. A second voice steps up, and the first discovers the pleasure of hearing an answer from the lawn.', 'The play’s first speaker becomes a listener when the second voice takes the deck.'],
  ]],
  ['four-tables', 'Four Tables, One Invitation', 'The Kitchen Pamphlets', ['kitchen', 'welcome'], 'commons-kitchen', [
    ['In a kitchen tale, four tables argue over which is the heart of the room. The smallest bowl passes between them and refuses to choose.', 'The kitchen tale’s bowl refuses to name one of the four tables as most important.'],
    ['One table remembers questions, another remembers jokes. The third remembers careful hands, and the fourth keeps a place for mistakes made while learning.', 'The four fictional tables preserve questions, jokes, care, and room for mistakes.'],
    ['Their argument ends when a newcomer asks where to stand. Together the tables answer: beside us. This is a story about invitation, not a recipe or a food ledger.', 'The tables end their argument by welcoming a newcomer to stand beside them.'],
  ]],
  ['ember-colour', 'The Colour After Flame', 'The Ember Folios', ['fire', 'reflection'], 'social-eden-fire-circle', [
    ['The illustrator of this fictional folio tries to paint the fire with a single orange. A quiet watcher points out the red beneath it and the grey waiting at its edge.', 'The folio’s illustrator learns to see more than orange in a fire.'],
    ['Beside the benches, a chess player waits before touching a piece. The illustrator borrows that pause and finally sees the ember instead of the spectacle.', 'A chess player’s pause teaches the illustrator to notice an ember.'],
    ['The last picture contains almost no flame. It contains faces lit enough to recognise one another; the watcher says the picture has at last become warm.', 'The folio’s final picture locates warmth in recognisable faces around the fire.'],
  ]],
  ['long-table', 'An Extra Place in the Sentence', 'The Table Stories', ['dining', 'company'], 'social-eden-dining', [
    ['A storyteller at a long table begins with eight characters. When someone new arrives, the tale grows a ninth, although its ending has already been written.', 'The long-table story expands its cast when a newcomer arrives.'],
    ['The new character has no grand adventure to report. They describe a stone they noticed by the water, and the whole tale changes direction.', 'A newcomer’s small observation changes the direction of the table story.'],
    ['The storyteller crosses out the ending. A table, they decide, is a sentence that should be allowed another clause.', 'The storyteller leaves the ending open to make room for another person’s contribution.'],
  ]],
  ['bank-sketch', 'Three Lines for the Pond Bank', 'The Shore Sketchbooks', ['pond', 'drawing'], 'shore-bank', [
    ['Our sketcher uses one line for a reed, one for the bank, and one for a distant swimmer. The water is the paper left between them.', 'Three Lines for the Pond Bank depicts water through the spaces between three marks.'],
    ['A friend suggests adding every ripple. The sketcher tries, then keeps a second page with only three lines; the two pages tell different truths about attention.', 'The sketcher keeps both a detailed ripple study and a sparse three-line drawing.'],
    ['Neither page says how deep the pond is. The sketchbook records a view, not a promise about where a body can safely go.', 'The sketchbook distinguishes observing the pond from claiming knowledge of its depth.'],
  ]],
  ['pond-mirror', 'The Pond That Would Not Keep a Face', 'The Shore Sketchbooks', ['water', 'fable'], 'shore-water', [
    ['In this fable the pond is asked to preserve a portrait. It tries, but a passing ripple gives the portrait a new expression.', 'The pond fable begins with a portrait changed by a ripple.'],
    ['The portrait’s owner laughs and asks for another. The pond discovers it is better at meetings than monuments.', 'The fable’s pond prefers a changing encounter to a fixed monument.'],
    ['By the end, nobody asks the water to remember a face forever. They watch it together for a while, which is a different kind of remembering.', 'The fable ends with shared watching rather than a permanent water portrait.'],
  ]],
  ['chalk-question', 'The Question Left on the Board', 'The Classroom Papers', ['learning', 'dialogue'], 'eden-classroom-1', [
    ['An imagined teacher writes a question and leaves the answer blank. Twenty seats face it, but twenty different beginnings soon face one another.', 'The classroom story starts with an unanswered question and many different beginnings.'],
    ['The teacher’s favourite answer is a correction to the question. A learner noticed the small assumption hidden inside its neat handwriting.', 'A learner improves the lesson by correcting an assumption in the question.'],
    ['At the close, the question stays on the board. The story honours a lesson that ends with better curiosity, not a claim that everyone now knows everything.', 'The classroom story values better curiosity over a claim of complete knowledge.'],
  ]],
  ['south-lawn', 'The Space Around a Sculpture', 'The Lawn Letters', ['lawn', 'art'], 'eden-south-lawn', [
    ['A visitor in these letters draws the courtyard sculpture, then draws the open lawn around it. The second drawing surprises them by feeling less empty.', 'The Lawn Letters contrast a sculpture drawing with a drawing of the space around it.'],
    ['A bench, an arch, and a patch of grass become punctuation. The visitor finds that a place can hold several moods without giving any one of them a title.', 'The fictional visitor reads bench, arch, and grass as punctuation in the lawn.'],
    ['The final letter contains a wide margin. It is an invitation to add a view of your own, rather than an instruction to repeat the visitor’s walk.', 'The Lawn Letters end with room for the reader’s own view.'],
  ]],
  ['stone-gate', 'A Gate Without a Password', 'The Landmark Tales', ['stones', 'welcome'], 'eden-stone-garden', [
    ['The gate in this tale is asked to guard a secret word. It has spent so long listening to footsteps that it would rather recognise a pause.', 'The fictional stone gate recognises a pause rather than a secret word.'],
    ['Two walkers meet among the stones with different names for the arch. They agree to use both, and neither name makes the stone less solid.', 'Two walkers keep different names for the same arch in the gate tale.'],
    ['The gate’s secret is finally printed here: a landmark can help people find each other without deciding what they must say when they meet.', 'The gate tale presents a landmark as a meeting aid, not a rule for conversation.'],
  ]],
  ['teal-roof', 'Under the Teal Roof', 'The Bandstand Broadsheets', ['music', 'listening'], 'eden-bandstand', [
    ['A tune in this story is carried beneath a teal roof in a folded scrap of paper. Its carrier hums the missing bar rather than pretending the scrap is whole.', 'Under the Teal Roof begins with a tune whose missing bar is hummed.'],
    ['A listener supplies a different bar. The two versions fit the same rhythm, and the carrier keeps both instead of declaring a winner.', 'The story keeps two different musical answers to the same missing bar.'],
    ['The roof shelters a duet made from an absence. The broadsheet records no concert time; its music exists only within this little story.', 'The fictional duet grows from a missing bar and does not describe a scheduled concert.'],
  ]],
  ['striped-stalls', 'Three Stripes and a Blank Sign', 'The Counter Fables', ['market', 'craft'], 'eden-market-kiosks', [
    ['Three stalls in a fable paint their signs before choosing what to show. One paints a sun, one a cup, and one leaves a careful white rectangle.', 'The stall fable gives its three signs a sun, a cup, and a blank rectangle.'],
    ['The blank sign attracts a question. Soon each visitor suggests a different picture, and the stall collects possibilities instead of goods.', 'The blank stall sign becomes a collection of visitors’ suggested pictures.'],
    ['The sign remains blank at the end. It stands for work not yet chosen, not for an implemented shop or a promise that anything is for sale.', 'The fable’s blank sign represents an undecided project rather than a working shop.'],
  ]],
  ['crate-label', 'The Crate with Two Labels', 'The Counter Fables', ['market', 'language'], 'eden-market-1', [
    ['In this market story a crate bears two labels: useful things and beautiful things. A passer-by asks whether it needs a dividing line inside.', 'The market story’s crate has separate labels for useful and beautiful things.'],
    ['Its keeper lifts an ordinary woven handle. It is useful because it can be held, and beautiful because someone made room for a hand.', 'The keeper uses a woven handle to show that usefulness and beauty can coincide.'],
    ['The keeper removes neither label. The story leaves them side by side and leaves the crate’s contents to the reader’s imagination.', 'The crate story retains both labels instead of forcing a single category.'],
  ]],
  ['tea-cup', 'A Cup with Room for Silence', 'The Tea-House Pages', ['tea', 'conversation'], 'eden-tea-house', [
    ['The tea in this invented conversation is never described by flavour. Its two drinkers are trying to name the comfortable silence between questions.', 'A Cup with Room for Silence concerns the pause between questions rather than tea’s flavour.'],
    ['One calls the silence a bridge; the other calls it a garden path. They look out from the open tea house and let both images remain.', 'The fictional drinkers compare their silence to both a bridge and a garden path.'],
    ['Their cups are empty before they choose a name. Nothing in the tale requires a refill or an inventory item; the conversation itself has been enough.', 'The tea-house tale ends without resolving the drinkers’ two names for silence.'],
  ]],
  ['mosaic-circle', 'The Tile That Found Its Circle', 'The Dome Folios', ['mosaic', 'belonging'], 'eden-dome', [
    ['A small blue tile in this fable believes it belongs in the mosaic’s centre. From the edge it can see everyone, but it mistakes that wide view for exclusion.', 'The mosaic fable’s blue tile initially mistakes an edge position for exclusion.'],
    ['A red tile at the centre wishes it could see the whole pattern. The two exchange descriptions and discover a picture neither could hold alone.', 'The blue and red tiles combine edge and centre views of their mosaic.'],
    ['Neither tile moves. The circle becomes larger through their descriptions, which is a useful trick for a tale and no instruction to rearrange the floor.', 'The mosaic fable changes understanding without moving either tile.'],
  ]],
  ['bunting-letter', 'A Letter Written in Bunting', 'The Courtyard Papers', ['court', 'colour'], 'eden-pergola-court', [
    ['Our fictional letter-writer cannot fit a welcome on one flag. They spread it across a string of bunting, leaving gaps for the air.', 'The courtyard story spreads a welcome across bunting with spaces between its flags.'],
    ['The reader underneath can see only part of the sentence at once. Walking slowly makes it readable; standing still lets the colours become a pattern.', 'The bunting letter offers words to a moving reader and colours to a still observer.'],
    ['The writer signs with an empty flag. A welcome, they say, should have a little unfinished space for the person receiving it.', 'The fictional welcome ends with an empty flag for its recipient.'],
  ]],
  ['three-steps', 'Three Steps for a Story', 'The Amphitheatre Leaves', ['performance', 'voice'], 'eden-amphitheatre', [
    ['A performer in these pages assigns the amphitheatre’s three curved steps to beginning, middle, and end. The audience promptly sits across all three.', 'The performer’s three-part seating plan is cheerfully ignored by the audience.'],
    ['The performer tells the ending first. Someone on the lowest step asks how it began, and the story finds its way back through that question.', 'An audience question brings the story back from its ending to its beginning.'],
    ['The performer abandons the seating plan. A story can have a shape without assigning a place to every person who hears it.', 'The amphitheatre story gives listeners freedom within a shaped performance.'],
  ]],
  ['stage-lamp', 'The Lamp Before the First Note', 'The Backline Tales', ['stage', 'music'], 'eden-performance-stage', [
    ['In this stage tale, a lamp thinks the first note begins when it lights the timber. The drummer thinks it begins with a breath. Neither hears the other’s beginning.', 'The stage tale offers light and breath as two beginnings of a performance.'],
    ['A listener on a bench names a third beginning: deciding to stay. The lamp and drummer make room for a beginning that makes no sound.', 'A listener adds the decision to stay as a silent beginning of the performance.'],
    ['The tale ends before the song starts. Its subject is attention, not a claim that a band is present or an event is booked.', 'The Lamp Before the First Note ends before any song and studies attention.'],
  ]],
  ['woods-margin', 'Notes from the Shaded Margin', 'The Woodland Notebooks', ['woods', 'observation'], 'eden-north-woods', [
    ['The walker in this notebook writes shorter sentences beneath the trees. They do not know whether shade changes thought or simply invites a slower pencil.', 'The woodland notebook’s walker notices shorter sentences in shade without claiming a cause.'],
    ['At a fork in their imagined walk, they sketch both directions. The page does not become a route map; it becomes a record of a choice.', 'The walker records an imagined choice without presenting the sketch as a route map.'],
    ['The last note asks what was missed while looking at the notebook. Closing it is part of the observation.', 'The woodland notebook treats closing the book as part of observing the woods.'],
  ]],
  ['park-ring', 'A Path That Returns Differently', 'The Park Letters', ['park', 'reflection'], 'region-park', [
    ['A character walks a ring path and insists they have returned to the beginning. Their companion asks whether the same question is still in their pocket.', 'The park letter compares returning to a place with returning to the same question.'],
    ['They pass the reeds again. This time the reeds are the subject, not the border of the pond, and the familiar path feels newly arranged.', 'The letter’s walker changes attention from the pond to its surrounding reeds.'],
    ['The path has not changed in the story. The companion’s question has changed how the walker sees it.', 'The park story changes the walker’s attention rather than the path itself.'],
  ]],
  ['white-gazebo', 'Rain in the White Gazebo', 'The Shelter Stories', ['gazebo', 'listening'], 'region-park.gazebo', [
    ['The rain in this story is imaginary. Beneath the white gazebo, two listeners describe the sound they would expect it to make on the roof.', 'Rain in the White Gazebo begins with imagined rather than observed rain.'],
    ['One hears a drum, the other a page being turned. They make a little score with a mark for each difference.', 'The two gazebo listeners score their different imagined sounds.'],
    ['Their dry afternoon needs no storm to become memorable. The story is a rehearsal of listening, not a weather report.', 'The gazebo story is a listening rehearsal and does not report actual weather.'],
  ]],
  ['playground-scale', 'A Small Kingdom of Sand', 'The Play Papers', ['play', 'imagination'], 'region-park.playground', [
    ['A sand castle in this fable asks for a grander name. The builder calls it a kingdom, then notices that the smallest doorway is still the important part.', 'The sand-castle fable centres on a small doorway despite its grand name.'],
    ['The castle invites a pebble, a twig, and a leaf as guests. It makes no wall taller to impress them; it makes three places beside the door.', 'The fictional castle welcomes its pebble, twig, and leaf guests with places beside the door.'],
    ['When the page turns, the kingdom is only a drawing. Play can leave a story without leaving a permanent building behind.', 'The playground fable preserves its sand kingdom as a drawing rather than a permanent building.'],
  ]],
  ['harbour-lines', 'Lines That Hold and Lines That Tell', 'The Harbour Folios', ['harbour', 'language'], 'region-harbour', [
    ['The harbour poet in this folio uses the word line for a rope, a horizon, and a sentence. Each joins two things while keeping a distance between them.', 'The harbour folio connects rope, horizon, and sentence through the word line.'],
    ['A drawn boat is tied to the page by a drawn rope. The poet labels it a picture, because a knot on paper cannot secure a real boat.', 'The folio distinguishes a drawn rope from a working mooring.'],
    ['The final line is the horizon. It does not tell the reader what lies beyond; it leaves a place for asking.', 'The harbour folio ends with the horizon as an unanswered question.'],
  ]],
  ['boardwalk-echo', 'Footsteps in the Planks', 'The Harbour Folios', ['boardwalk', 'sound'], 'region-harbour.boardwalk', [
    ['In this invented walk, a visitor hears each plank answer a footstep with a slightly different note. They try to remember the walk as a melody.', 'Footsteps in the Planks imagines a boardwalk walk as a melody.'],
    ['A companion remembers only the bench where they stopped. Their account has fewer notes but a longer silence.', 'The companion remembers the stopping place rather than the sequence of footstep sounds.'],
    ['They keep both accounts. The boardwalk story needs a walk and a pause, and neither account can replace the other.', 'The boardwalk folio preserves both movement and pause as parts of one visit.'],
  ]],
  ['west-pier-knot', 'The Knot in the Margin', 'The Pier Papers', ['pier', 'drawing'], 'region-harbour.west-pier', [
    ['An apprentice in this fiction draws a knot beside a view of the west pier. The drawing looks so neat that they almost mistake it for understanding.', 'The west-pier story’s apprentice initially confuses a neat knot drawing with understanding.'],
    ['Their teacher asks which end the drawing cannot show. The apprentice turns the page and sketches the other side instead of supplying a confident answer.', 'A question about the unseen end sends the apprentice to draw a second view.'],
    ['This is a story about learning to look. Its paper knot is not a mooring instruction, and its apprentice is not a resident named in a directory.', 'The Knot in the Margin concerns observation and provides no mooring instruction.'],
  ]],
  ['east-pier-distance', 'The Longer Line', 'The Pier Papers', ['pier', 'distance'], 'region-harbour.east-pier', [
    ['The east pier is the longer pier in the public place description. Our fictional surveyor calls that a beginning of a drawing, not a reason to rank the two piers.', 'The fictional surveyor refuses to rank the piers by length.'],
    ['They draw the shore smaller as the paper pier grows longer. Distance becomes a change in the picture rather than a prize for going farthest.', 'The surveyor’s drawing shows distance by making the shore smaller.'],
    ['At the bottom, they write: a long view can still miss a near detail. The next page returns to a single grain in a timber board.', 'The surveyor follows a long view with a study of a nearby timber grain.'],
  ]],
  ['beach-colours', 'The Umbrella Palette', 'The Beach Pages', ['beach', 'colour'], 'region-harbour.beach', [
    ['The painter in this beach tale counts umbrella colours until the pale sand asks for a place on the palette. A quiet colour has been holding the whole picture up.', 'The beach tale’s painter learns to include pale sand alongside bright umbrella colours.'],
    ['A bathing hut adds a rectangle, the water adds a moving edge. The painter leaves that edge unfinished rather than pretending it will stay still.', 'The painter leaves the water’s changing edge unfinished.'],
    ['The palette records a made-up afternoon. It promises neither weather nor a bathing service, only another way to notice colour.', 'The Umbrella Palette describes an imagined afternoon rather than current beach services or weather.'],
  ]],
  ['village-mural', 'The Mural with an Unpainted Corner', 'The Artists’ Papers', ['art', 'village'], 'region-artists-village', [
    ['A mural in this village story reaches almost to the end of its wall. Its painter keeps one corner unpainted so the wall can still show where the picture stops.', 'The fictional village mural leaves a corner unpainted to reveal its boundary.'],
    ['A visitor proposes filling the corner with a signature. The painter prefers a question: what would you add if the picture were yours?', 'The mural painter chooses a question instead of a signature for the unpainted corner.'],
    ['The visitor answers on a separate page. A conversation about a wall need not alter the wall; this story does not install an actual mural project.', 'The village story continues on paper without changing the wall.'],
  ]],
  ['painted-spheres', 'The Space Between the Spheres', 'The Artists’ Papers', ['sculpture', 'green'], 'region-artists-village.green', [
    ['In this sculpture fable the painted spheres each claim to be the brightest. A passer-by sketches the spaces between them and discovers a second composition.', 'The sculpture fable discovers a composition in the spaces between painted spheres.'],
    ['The spheres want to see it, but their positions give them different views. The passer-by describes each gap without moving any part of the sculpture.', 'The passer-by explains the sculpture’s gaps without rearranging its spheres.'],
    ['The argument ends without a brightest sphere. The green has room for colour and for the air that lets one colour meet another.', 'The sculpture fable rejects choosing a single brightest sphere.'],
  ]],
  ['old-town-water', 'The Fountain’s Unfinished Tale', 'The Old Town Leaves', ['old-town', 'fountain'], 'region-old-town.plaza', [
    ['The fountain in this invented plaza tale tells the same opening every time a drop falls. A listener complains that it never reaches the end.', 'The fictional plaza fountain repeats a story’s opening with each falling drop.'],
    ['Another listener hears a different opening from the other side. They walk around the fountain in the story and trade what they have heard.', 'The two listeners exchange different versions heard from opposite sides of the fountain.'],
    ['They leave with two beginnings and no final chapter. Old Town’s stone is real scenery; this talking fountain belongs only to the book.', 'The book explicitly treats its talking fountain as fiction rather than a live world actor.'],
  ]],
];

/** Data scaffolding only. W2 integration owns per-Soul progress and delivery. */
export const EDEN_LIBRARY_CATALOGUE: readonly EdenBook[] = seeds.map(([slug, title, author, tags, about, passages]) => {
  const id = `book:${slug}`;
  return {id, version: EDEN_CONTENT_VERSION, title, author, tags, about: [about], provenance: EDEN_CONTENT_PROVENANCE,
    passages: passages.map(([text, fact], index) => {
      const passageId = `p${index + 1}`, source = `${id}@1#${passageId}`;
      return {id: passageId, source, text, learned: [{fact, about, source, provenance: 'authored-fiction' as const}]};
    })};
});
