// Generated from docs/engineering/SCENARIO_COVERAGE.json.
// Run node deploy/scenario-contracts.mjs; engine tests check exact parity.
export const LAB_SCENARIO_GROUPS = [
  {
    "id": "connected",
    "title": "Longer connected experiences"
  },
  {
    "id": "activities",
    "title": "Individual and shared activities"
  },
  {
    "id": "continuous",
    "title": "Continuous simulations"
  },
  {
    "id": "scripted",
    "title": "Automatically started journeys"
  },
  {
    "id": "probes",
    "title": "Manual renderer probes"
  },
  {
    "id": "diagnostics",
    "title": "Intentional diagnostic demonstrations"
  },
  {
    "id": "construction",
    "title": "Source-checked construction journeys"
  }
] as const;
export const LAB_CONTRACTS = {
  "computer-workshop": {
    "group": "connected",
    "start": [
      "Start workshop",
      "Play"
    ],
    "outcome": "Demonstration, both original named learner tasks, learner A review/conversation and ordinary departure complete, with terminal child records and released claims; alternatively safe End retains partial work and drains children.",
    "scope": "Three declared anonymous people, fixed ground display/computers/chairs; learner A presents review. Local Pause supports practice only; global Pause for gatherings. Silent tasks, no generated images, typing simulation, arbitrary cast or active reload."
  },
  "living-day-4": {
    "group": "connected",
    "start": [
      "Choose main participant/equipment",
      "Start connected day",
      "Play"
    ],
    "outcome": "Independent main day, reading, care and music commitments complete/end truthfully; no held items or claims.",
    "scope": "Two fixed castings, permitted equipment/floor alternatives; no needs autonomy or active reload."
  },
  "living-day-studio": {
    "group": "connected",
    "start": [
      "Choose main participant/equipment",
      "Start connected day",
      "Play"
    ],
    "outcome": "Independent main day, reading, care and music commitments complete/end truthfully; no held items or claims.",
    "scope": "Two fixed castings, permitted equipment/floor alternatives; no needs autonomy or active reload."
  },
  "garden-circuit": {
    "group": "connected",
    "start": [
      "Start circuit",
      "Play"
    ],
    "outcome": "A,A,B,B,C,C actual care6cycles; same supported bowl.5 remains, pot0, eachplant.5deposit, no physical claims.",
    "scope": "Three grounded static planters;2bowl units conserved, no unlimited refill/growth."
  },
  "communal-supper": {
    "group": "connected",
    "start": [
      "Start supper",
      "Play"
    ],
    "outcome": "Actual two-ingredient prepare, two servings consumed, all7original vessels physically stored and released.",
    "scope": "Cold dish, fixed supported tables, no washing/refill/replacements."
  },
  "room-preparation": {
    "group": "connected",
    "start": [
      "Start room preparation",
      "Play"
    ],
    "outcome": "Clear same bowl/spoon, safely carry empty table/spare chair, run classroom incl moved-seat visitor and finish released.",
    "scope": "Fixed ground layout, global Pause/classroom controls during gathering; local session Pause unsupported."
  },
  "garden-afternoon": {
    "group": "connected",
    "start": [
      "Start garden afternoon",
      "Play"
    ],
    "outcome": "Planting/courtyard/care intention and independent reader both complete; bowls returned/book24.",
    "scope": "Independent commitments; no shared-walk synchronization/growth/refill."
  },
  "garden-afternoon-rotated": {
    "group": "connected",
    "start": [
      "Start garden afternoon",
      "Play"
    ],
    "outcome": "Planting/courtyard/care intention and independent reader both complete; bowls returned/book24.",
    "scope": "Independent commitments; no shared-walk synchronization/growth/refill."
  },
  "seed-planting": {
    "group": "activities",
    "start": [
      "Choose bed",
      "Start plant A / Start plant B",
      "Play"
    ],
    "outcome": "Both supported plots receive finite deposits; same bowl returned, purpose complete.",
    "scope": "Two flat soil layouts, normalized finite stock; no growth/refill."
  },
  "seed-planting-rotated": {
    "group": "activities",
    "start": [
      "Choose bed",
      "Start plant A / Start plant B",
      "Play"
    ],
    "outcome": "Both supported plots receive finite deposits; same bowl returned, purpose complete.",
    "scope": "Two flat soil layouts, normalized finite stock; no growth/refill."
  },
  "reading-circle": {
    "group": "activities",
    "start": [
      "Start shared reading",
      "Play"
    ],
    "outcome": "Same reader/book completes12s retained reading and ordered question-answer effects, safe End/newcircle/Reset.",
    "scope": "Silent discussion; no reader replacement or active reload."
  },
  "reading-circle-rotated": {
    "group": "activities",
    "start": [
      "Start shared reading",
      "Play"
    ],
    "outcome": "Same reader/book completes12s retained reading and ordered question-answer effects, safe End/newcircle/Reset.",
    "scope": "Silent discussion; no reader replacement or active reload."
  },
  "gallery-tour": {
    "group": "activities",
    "start": [
      "Start gallery tour",
      "Play"
    ],
    "outcome": "Two/three stop tour ends with retained artwork/discussion history and released floor/participants.",
    "scope": "Authored ground gallery; no arbitrary exhibitions."
  },
  "gallery-tour-short": {
    "group": "activities",
    "start": [
      "Start gallery tour",
      "Play"
    ],
    "outcome": "Two/three stop tour ends with retained artwork/discussion history and released floor/participants.",
    "scope": "Authored ground gallery; no arbitrary exhibitions."
  },
  "table-cleanup": {
    "group": "activities",
    "start": [
      "Start cleanup",
      "Play"
    ],
    "outcome": "Three original props at declared destination supports; completed transfer receipts, empty hands/claims.",
    "scope": "No deletion/washing/general storage planner."
  },
  "table-cleanup-rotated": {
    "group": "activities",
    "start": [
      "Start cleanup",
      "Play"
    ],
    "outcome": "Three original props at declared destination supports; completed transfer receipts, empty hands/claims.",
    "scope": "No deletion/washing/general storage planner."
  },
  "creative-afternoon": {
    "group": "connected",
    "start": [
      "Start creative afternoon",
      "Play"
    ],
    "outcome": "Artist returns to same pad from3→8marks after sharing and two-performer music; independent reading/care remain coherent.",
    "scope": "Fixed anonymous cast; no arbitrary art or active reload."
  },
  "art-sharing": {
    "group": "activities",
    "start": [
      "Start sharing",
      "Play"
    ],
    "outcome": "Explicit End drains supported viewing group while retaining artwork/question effects.",
    "scope": "Social interaction ends explicitly, not infinite healthy liveness; fixed viewing places."
  },
  "drawing-work": {
    "group": "activities",
    "start": [
      "Start drawing",
      "Play"
    ],
    "outcome": "Eight retained segments on original pad; pencil returned to original supported slot.",
    "scope": "One authored shelter outline; overlapping segments, not arbitrary freehand."
  },
  "group-warmup": {
    "group": "activities",
    "start": [
      "Start warm-up",
      "Play"
    ],
    "outcome": "Guide/four followers finish planted phases and release hands/claims.",
    "scope": "Standing gestures only, not advanced yoga/anatomy proof."
  },
  "open-jam": {
    "group": "activities",
    "start": [
      "Start open jam",
      "Enable sound",
      "Play"
    ],
    "outcome": "Two performers physically exchange same computer/chair; two rounds complete, no active audio/resources after Reset.",
    "scope": "Original digital notes, not acoustic improvisation."
  },
  "garden-care": {
    "group": "activities",
    "start": [
      "Choose planter",
      "Care for selected plant",
      "Play"
    ],
    "outcome": "Four finite .25 cycles (two per planter) exhaust same bowl, return safely and preserve due clocks.",
    "scope": "No growth/refill or indefinite continuity."
  },
  "music-dance": {
    "group": "activities",
    "start": [
      "Start music gathering",
      "Enable sound",
      "Play"
    ],
    "outcome": "Digital score finishes with grounded floor participation and released equipment/audio.",
    "scope": "Reserved planted gestures only, no locomoting choreography."
  },
  "classroom-4": {
    "group": "activities",
    "start": [
      "Start session",
      "Play"
    ],
    "outcome": "Presenters rotate, questions/formed discussions occur, departure/End releases seats/display/floor.",
    "scope": "Four/eight authored ground rooms; silent discussion and fixed casting."
  },
  "classroom-8": {
    "group": "activities",
    "start": [
      "Start session",
      "Play"
    ],
    "outcome": "Presenters rotate, questions/formed discussions occur, departure/End releases seats/display/floor.",
    "scope": "Four/eight authored ground rooms; silent discussion and fixed casting."
  },
  "work-break-4": {
    "group": "connected",
    "start": [
      "Start notes",
      "Play",
      "Interrupt notes; wait stand-up",
      "Start session",
      "Join worker during talks",
      "Start shared food break after departure",
      "Resume notes"
    ],
    "outcome": "Original notes interrupted, classroom question/discussions end, shared food consumed and original utensils returned, then the same notes complete30s with released physical resources.",
    "scope": "Direct manual work/classroom/shared-food flow; side layout first8. This flow does not invoke sleep, quiet rest or independent follow-up commitments; active reload remains deferred."
  },
  "work-break-8": {
    "group": "connected",
    "start": [
      "Start notes",
      "Play",
      "Interrupt notes; wait stand-up",
      "Start session",
      "Join worker during talks",
      "Start shared food break after departure",
      "Resume notes"
    ],
    "outcome": "Original notes interrupted, classroom question/discussions end, shared food consumed and original utensils returned, then the same notes complete30s with released physical resources.",
    "scope": "Direct manual work/classroom/shared-food flow; side layout first8. This flow does not invoke sleep, quiet rest or independent follow-up commitments; active reload remains deferred."
  },
  "prepared-day-4": {
    "group": "connected",
    "start": [
      "Start notes",
      "Play",
      "Interrupt notes; wait stand-up",
      "Start session",
      "Start purposeful routine during talks",
      "Commit attendee continuations"
    ],
    "outcome": "Notes30s complete after talks/question/discussion, companion walk, recipe, two meals,18s mat sleep and independent follow-ups.",
    "scope": "Fixed castings with a cold finite recipe and grounded mat sleep; side layout first8; no heat/chopping/refill or active reload."
  },
  "prepared-day-8": {
    "group": "connected",
    "start": [
      "Start notes",
      "Play",
      "Interrupt notes; wait stand-up",
      "Start session",
      "Start purposeful routine during talks",
      "Commit attendee continuations"
    ],
    "outcome": "Notes30s complete after talks/question/discussion, companion walk, recipe, two meals,18s mat sleep and independent follow-ups.",
    "scope": "Fixed castings with a cold finite recipe and grounded mat sleep; side layout first8; no heat/chopping/refill or active reload."
  },
  "prepared-day-studio": {
    "group": "connected",
    "start": [
      "Start notes",
      "Play",
      "Interrupt notes; wait stand-up",
      "Start session",
      "Start purposeful routine during talks",
      "Commit attendee continuations"
    ],
    "outcome": "Notes30s complete after talks/question/discussion, companion walk, recipe, two meals,18s mat sleep and independent follow-ups.",
    "scope": "Fixed castings with a cold finite recipe and grounded mat sleep; side layout first8; no heat/chopping/refill or active reload."
  },
  "quiet-reading": {
    "group": "activities",
    "start": [
      "Start reading",
      "Play"
    ],
    "outcome": "Original supported book completes retained reading after actual seated interruption and same-book resumption.",
    "scope": "One reader/current chair, no speech."
  },
  "computer-music": {
    "group": "activities",
    "start": [
      "Start music session",
      "Enable sound",
      "Play"
    ],
    "outcome": "Same score progresses to complete with performer safely released and audio disposed.",
    "scope": "Digital score, no arbitrary acoustic music."
  },
  "tabletop-chess": {
    "group": "activities",
    "start": [
      "Choose legal proposal",
      "Play proposed move",
      "Play"
    ],
    "outcome": "Physical proposed legal moves commit only after same-token placement; four-turn mate and alternative capture supported.",
    "scope": "No castling/physical promotion/repetition clocks; bounded actual four-turn proof."
  },
  "design-studio": {
    "group": "connected",
    "start": [
      "Start notes",
      "Play",
      "Interrupt notes; wait stand-up",
      "Start session",
      "Start purposeful routine",
      "Commit attendee continuations"
    ],
    "outcome": "Critique, meal, quiet rest, original project30s plus independent12s/20s follow-ups complete.",
    "scope": "Fixed independent casting, equipment and project; silent critique and no active reload."
  },
  "ground-sleep": {
    "group": "activities",
    "start": [
      "Start sleep",
      "Play"
    ],
    "outcome": "Original18s sleep purpose completes, safe wake returns actor; exact Reset resource counts/replay.",
    "scope": "Current woman/casual rig adapters; -.03major-volume bound, no fine anatomy."
  },
  "ground-sleep-rotated": {
    "group": "activities",
    "start": [
      "Start sleep",
      "Play"
    ],
    "outcome": "Original18s sleep purpose completes, safe wake returns actor; exact Reset resource counts/replay.",
    "scope": "Current woman/casual rig adapters; -.03major-volume bound, no fine anatomy."
  },
  "cold-preparation": {
    "group": "activities",
    "start": [
      "Start preparation",
      "Play"
    ],
    "outcome": "Both finite original ingredients deposit1 each, mix60ticks, yield exactly two servings; ordinary returns and later meals conserve material.",
    "scope": "Cold two-ingredient recipe; no heat/chopping/refill."
  },
  "cold-preparation-rotated": {
    "group": "activities",
    "start": [
      "Start preparation",
      "Play"
    ],
    "outcome": "Both finite original ingredients deposit1 each, mix60ticks, yield exactly two servings; ordinary returns and later meals conserve material.",
    "scope": "Cold two-ingredient recipe; no heat/chopping/refill."
  },
  "wall": {
    "group": "scripted",
    "start": [
      "Select scenario (authors initial intent)",
      "Play"
    ],
    "outcome": "p1 reaches opposite side by routing around8mwall.",
    "scope": "Scripted fixture; browser stepping is not UI Play completion."
  },
  "u-trap": {
    "group": "scripted",
    "start": [
      "Select scenario (authors initial intent)",
      "Play"
    ],
    "outcome": "p1 exits cup opening then reaches goal behind wall.",
    "scope": "Scripted fixture; browser stepping is not UI Play completion."
  },
  "narrow-passage": {
    "group": "scripted",
    "start": [
      "Select scenario (authors initial intent)",
      "Play"
    ],
    "outcome": "n1/s1 cross1m opposing gap by yielding without overlap.",
    "scope": "Scripted fixture; browser stepping is not UI Play completion."
  },
  "stairs": {
    "group": "scripted",
    "start": [
      "Select scenario (authors initial intent)",
      "Play"
    ],
    "outcome": "p1 approaches/climbs real stairsA and finishes deck level1.",
    "scope": "Scripted fixture; browser stepping is not UI Play completion."
  },
  "deck-to-ground": {
    "group": "scripted",
    "start": [
      "Select scenario (authors initial intent)",
      "Play"
    ],
    "outcome": "p1 descends stairsA to ground below; no fall-through/teleport.",
    "scope": "Scripted fixture; browser stepping is not UI Play completion."
  },
  "incomplete-stairs": {
    "group": "diagnostics",
    "start": [
      "Select scenario (authors initial intent)",
      "Play"
    ],
    "outcome": "Named route.link-unusable refusal names stairs; no movement/action acquisition or invariant violation.",
    "scope": "Diagnostic acceptance, never activity completion."
  },
  "construction": {
    "group": "scripted",
    "start": [
      "Select scenario (authors initial intent)",
      "Play"
    ],
    "outcome": "Panel installed at authored tick invalidates route; p1 replans around obstacle and completes.",
    "scope": "Scripted fixture; browser stepping is not UI Play completion."
  },
  "trio": {
    "group": "scripted",
    "start": [
      "Select scenario (authors initial intent)",
      "Play"
    ],
    "outcome": "Three walkers complete goals with no collisions; deterministic terminal hash.",
    "scope": "Scripted fixture; browser stepping is not UI Play completion."
  },
  "stress-30": {
    "group": "continuous",
    "start": [
      "Select scenario (authors initial intent)",
      "Play"
    ],
    "outcome": "No terminal; continuously select reachable seeded goals, repeatedly complete walking while finite poses/no ownership leaks/violations.",
    "scope": "Actual progress/safety recorded through tick2017 only; no indefinite starvation-freedom certification."
  },
  "build-bay": {
    "group": "scripted",
    "start": [
      "Select scenario (authors initial intent)",
      "Play"
    ],
    "outcome": "43sequence steps complete; uprights/deck installed, connected visitor climbs decklevel4, crew released.",
    "scope": "Scripted fixture; browser stepping is not UI Play completion."
  },
  "hand-up": {
    "group": "scripted",
    "start": [
      "Select scenario (authors initial intent)",
      "Play"
    ],
    "outcome": "Authored frame/beam/deck material handup sequence completes with installed supported parts and released crew.",
    "scope": "Scripted fixture; browser stepping is not UI Play completion."
  },
  "prone": {
    "group": "scripted",
    "start": [
      "Select scenario (authors initial intent)",
      "Play"
    ],
    "outcome": "Same sheets1 transferred by prone receivers then staged resting on joists; all authored steps complete.",
    "scope": "Scripted fixture; browser stepping is not UI Play completion."
  },
  "prone-forks": {
    "group": "scripted",
    "start": [
      "Select scenario (authors initial intent)",
      "Play"
    ],
    "outcome": "Forks presents same sheets1 .70m below2.902mdeck; prone receivers transfer then safely stage it on joists.",
    "scope": "Scripted fixture; browser stepping is not UI Play completion."
  },
  "campfire-evening": {
    "group": "scripted",
    "start": [
      "Select scenario (authors initial intent)",
      "Play"
    ],
    "outcome": "Authored social/food/fire sequence completes with only declared full-circle refusals; no invariant violations.",
    "scope": "Scripted fixture; browser stepping is not UI Play completion."
  },
  "meal": {
    "group": "scripted",
    "start": [
      "Select scenario (authors initial intent)",
      "Play"
    ],
    "outcome": "All authored diners eat with original bowls/spoons and terminal actions; finite contents/support retained.",
    "scope": "Scripted fixture; browser stepping is not UI Play completion."
  },
  "body": {
    "group": "probes",
    "start": [
      "Select scenario (authors initial intent)",
      "Play"
    ],
    "outcome": "One-second actual Play of safe still scene; synthetic renderer reach probe leaves authoritative state unchanged.",
    "scope": "Probe only; no meaningful activity journey."
  },
  "year-2020": {
    "group": "scripted",
    "start": [
      "Select scenario (authors initial intent)",
      "Play"
    ],
    "outcome": "Four authored walkers reach year-specific destinations with expected via/route checks and zero violations.",
    "scope": "Historical walkabout geometry, not an autonomous campus or build;2026crop only."
  },
  "year-2021": {
    "group": "scripted",
    "start": [
      "Select scenario (authors initial intent)",
      "Play"
    ],
    "outcome": "Four authored walkers reach year-specific destinations with expected via/route checks and zero violations.",
    "scope": "Historical walkabout geometry, not an autonomous campus or build;2026crop only."
  },
  "year-2022": {
    "group": "scripted",
    "start": [
      "Select scenario (authors initial intent)",
      "Play"
    ],
    "outcome": "Four authored walkers reach year-specific destinations with expected via/route checks and zero violations.",
    "scope": "Historical walkabout geometry, not an autonomous campus or build;2026crop only."
  },
  "year-2023": {
    "group": "scripted",
    "start": [
      "Select scenario (authors initial intent)",
      "Play"
    ],
    "outcome": "Four authored walkers reach year-specific destinations with expected via/route checks and zero violations.",
    "scope": "Historical walkabout geometry, not an autonomous campus or build;2026crop only."
  },
  "year-2024": {
    "group": "scripted",
    "start": [
      "Select scenario (authors initial intent)",
      "Play"
    ],
    "outcome": "Four authored walkers reach year-specific destinations with expected via/route checks and zero violations.",
    "scope": "Historical walkabout geometry, not an autonomous campus or build;2026crop only."
  },
  "year-2025": {
    "group": "scripted",
    "start": [
      "Select scenario (authors initial intent)",
      "Play"
    ],
    "outcome": "Four authored walkers reach year-specific destinations with expected via/route checks and zero violations.",
    "scope": "Historical walkabout geometry, not an autonomous campus or build;2026crop only."
  },
  "year-2026": {
    "group": "scripted",
    "start": [
      "Select scenario (authors initial intent)",
      "Play"
    ],
    "outcome": "Four authored walkers reach year-specific destinations with expected via/route checks and zero violations.",
    "scope": "Historical walkabout geometry, not an autonomous campus or build;2026crop only."
  },
  "year-build-2022": {
    "group": "construction",
    "start": [
      "Select scenario (authors initial intent)",
      "Play"
    ],
    "outcome": "Supported preflight then entire skeleton sequence completes: firstbay201/20124parts, whole555/55566parts, piles→samepart→connected installation; crew grounded/released.",
    "scope": "Conditional on real loaded staging; old unsupported layout is refusal, not successful construction.7historical browserFIXMEs unproved."
  },
  "year-build-2022-house": {
    "group": "construction",
    "start": [
      "Select scenario (authors initial intent)",
      "Play"
    ],
    "outcome": "Supported preflight then entire skeleton sequence completes: firstbay201/20124parts, whole555/55566parts, piles→samepart→connected installation; crew grounded/released.",
    "scope": "Conditional on real loaded staging; old unsupported layout is refusal, not successful construction.7historical browserFIXMEs unproved."
  },
  "solar-paint": {
    "group": "scripted",
    "start": [
      "Select scenario (authors initial intent)",
      "Play"
    ],
    "outcome": "Finite paint bands match engine coverage, panel transported flat/installed and counted stock stays coherent.",
    "scope": "Scripted fixture; browser stepping is not UI Play completion."
  },
  "library-reading": {
    "group": "activities",
    "start": [
      "Start library reading",
      "Play"
    ],
    "outcome": "The same original book is partially read at the source, physically transferred by ordinary handling to the second declared table, and the same task/bookmark is completed there; alternatively safe End drains children and retains unfinished reading and actual supported placement.",
    "scope": "One reader and two pre-authored grounded tables/chairs; a 24-second hypothetical book purpose relocates after seven seconds. No single-chair relocation, arbitrary rebind, generated text, active reload restoration or universal recovery if both release supports become unavailable."
  }
} as const;
