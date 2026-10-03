# R2 image sources (scratch notes for R2-agent-worlds-landscape.html)

Status: **partial**, checkpointed 2026-10-02. Every URL below was checked that day with
`curl -sIL -A <browser UA> <url>`; "200 image/…" means HTTP 200 and an image content-type.
**No image has been looked at.** What each one shows is inferred from its file name or its
source page, so each needs a visual check before its caption is trusted. Nothing was
downloaded to disk.

Steam URLs: the API returns them with a `?t=…` cache parameter; they were verified and are
listed without it. To list a game's screenshots again:
`curl -s "https://store.steampowered.com/api/appdetails?appids=<id>&l=english&cc=US"`.

## Past

### Habitat — source page https://github.com/frandallfarmer/neohabitat (README); credit NeoHabitat project, original art Lucasfilm Games
- 200 image/png · https://raw.githubusercontent.com/frandallfarmer/neohabitat-doc/master/docs/images/neohabitat_downtown.png · in-world downtown scene (by name)
- 200 image/png · https://raw.githubusercontent.com/frandallfarmer/neohabitat-doc/master/docs/images/habitat_imagery.png · montage (by name)
- 200 image/png · https://raw.githubusercontent.com/frandallfarmer/neohabitat-doc/master/docs/images/neohabitat_splash.png · splash screen (by name)
- 200 image/png · https://raw.githubusercontent.com/frandallfarmer/neohabitat-doc/master/docs/images/launcher_login.png · launcher, not in-world
- 200 image/jpeg · https://upload.wikimedia.org/wikipedia/en/d/d8/Habitat_cover.jpg · cover art, not a screenshot (https://en.wikipedia.org/wiki/Habitat_(video_game))

### LambdaMOO — no image. Text world.
- Real server greeting captured as text over telnet (lambda.moo.mud.org 8888) on 2026-10-02; used on the page as a `<pre>` block.
- Commons search found only a photo of Pavel Curtis (not used).

### Creatures — source page https://store.steampowered.com/app/1818340/ ("Creatures: The Albian Years", official store screenshots)
- 200 image/jpeg · https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1818340/ss_74df050ba501675a9512c86dc30678ae3cc29b25.1920x1080.jpg
- 200 image/jpeg · https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1818340/ss_32f915fecc2f02f67711a60385833776cf224b97.1920x1080.jpg
- 200 image/jpeg · https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1818340/ss_e77cb66e2eaf85dc89bb8d1172b55fb05e141895.1920x1080.jpg
- 200 image/jpeg · https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1818340/ss_4d8a7ec61962c247c1fe0ea1d61234351cdefb57.1920x1080.jpg
- 200 image/jpeg · https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1818340/ss_08894c52f9c34a21c8c115ce1e46b2e0f684fa4f.1920x1080.jpg
- 200 image/png · https://upload.wikimedia.org/wikipedia/en/d/da/Creatures_2_game_new_Norn.PNG · Creatures 2, 384×260 (https://en.wikipedia.org/wiki/Creatures_(video_game_series))

### The Sims — source page https://store.steampowered.com/app/3314060/ (The Sims Legacy Collection, Electronic Arts)
- 200 image/jpeg · https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3314060/d289293ae1b654bfa18fa9ead5aeaa1813d0c5c3/ss_d289293ae1b654bfa18fa9ead5aeaa1813d0c5c3.1920x1080.jpg
- 200 image/jpeg · https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3314060/307ccbd284bed0a8c756d444fbf8728fc2a005c8/ss_307ccbd284bed0a8c756d444fbf8728fc2a005c8.1920x1080.jpg
- 200 image/jpeg · https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3314060/cf535f0a081d8c6118694f0597c073d91e54ca18/ss_cf535f0a081d8c6118694f0597c073d91e54ca18.1920x1080.jpg
- 200 image/jpeg · https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3314060/f8950aa4a442c9df0d406846c4240a6c5f20e7ac/ss_f8950aa4a442c9df0d406846c4240a6c5f20e7ac.1920x1080.jpg
- 200 image/jpeg · https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3314060/0624db5c639beaad3b916a4525c85004df61f2c0/ss_0624db5c639beaad3b916a4525c85004df61f2c0.1920x1080.jpg
- 200 image/jpeg · https://upload.wikimedia.org/wikipedia/en/9/91/SimsSS.jpg · 365×273 (https://en.wikipedia.org/wiki/The_Sims_(video_game))
- 200 image/jpeg · https://upload.wikimedia.org/wikipedia/en/9/96/Sims_NH.JPG · neighbourhood view, 365×273 (same page)

### Black & White — only a small image found
- 200 image/jpeg · https://upload.wikimedia.org/wikipedia/en/2/2a/LionheadBW.jpg · 365×273, non-free (https://en.wikipedia.org/wiki/Black_%26_White_(video_game))
- Not on Steam (search returned unrelated titles). MobyGames and the Internet Archive were not tried.

### Façade — official screenshots from the developers' site as archived (https://web.archive.org/web/2006/http://www.interactivestory.net/); credit Procedural Arts (Mateas & Stern)
- 200 image/jpeg · https://web.archive.org/web/20060114000455im_/http://www.interactivestory.net:80/facadeimages/facade_1playergreets.jpg
- 200 image/jpeg · https://web.archive.org/web/20060113233703im_/http://www.interactivestory.net:80/facadeimages/facade_2gracegreets.jpg
- 200 image/jpeg · https://web.archive.org/web/20060426031558im_/http://www.interactivestory.net:80/facadeimages/facade_3troubleinparadise.jpg
- 200 image/jpeg · https://web.archive.org/web/20060116151055im_/http://www.interactivestory.net:80/facadeimages/facade_4arguing.jpg
- 200 image/jpeg · https://web.archive.org/web/20060426031528im_/http://www.interactivestory.net:80/facadeimages/facade_5therapygame.jpg
- 200 image/jpeg · https://upload.wikimedia.org/wikipedia/en/9/9c/Facade_screenshot_Trip_%26_Grace.jpg · 371×268 (https://en.wikipedia.org/wiki/Fa%C3%A7ade_(video_game))
- Note: the live interactivestory.net now serves unrelated content; do not link to it as the source.

### Dwarf Fortress — https://store.steampowered.com/app/975370/ (Bay 12 Games / Kitfox Games)
- 200 image/jpeg · https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/975370/72780d67585fda02ff95373c9cfc0a7b35193341/ss_72780d67585fda02ff95373c9cfc0a7b35193341.1920x1080.jpg
- 200 image/jpeg · https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/975370/539fd25e713be0c3f995b71256971d774934c41c/ss_539fd25e713be0c3f995b71256971d774934c41c.1920x1080.jpg
- 200 image/jpeg · https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/975370/ss_a1478493de292f1c57a9522d00ee5b692ce0e4c7.1920x1080.jpg
- 200 image/jpeg · https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/975370/ss_f8aa4e5f896a8ecb7abf3a8c7c4ae176ba40f3ae.1920x1080.jpg
- 200 image/png · https://upload.wikimedia.org/wikipedia/en/c/c6/Dwarf_Fortress_embark_scene.png · classic text mode, 412×238 (https://en.wikipedia.org/wiki/Dwarf_Fortress)
- 200 image/png · https://upload.wikimedia.org/wikipedia/en/f/ff/Dwarf_Fortress_adventurer_mode.png · 420×236 (same page)
- 200 image/png · https://upload.wikimedia.org/wikipedia/commons/3/3b/Drawf_Fortress_-_Aaron_A._Reed_world_map.png · generated world map, 1687×2587 (https://commons.wikimedia.org/wiki/File:Drawf_Fortress_-_Aaron_A._Reed_world_map.png)

### Second Life — Wikimedia Commons; authors and licences are on each file page (not yet copied)
- 200 image/png · https://upload.wikimedia.org/wikipedia/commons/6/6f/User_generated_content_in_the_virtual_world_Second_Life.png · 5000×3750
- 200 image/png · https://upload.wikimedia.org/wikipedia/commons/0/04/Virtual_concert_in_Second_Life.png · 1920×1033
- 200 image/png · https://upload.wikimedia.org/wikipedia/commons/5/51/Map_over_Bay_City%2C_Second_Life.png · 1368×706
- 200 image/png · https://upload.wikimedia.org/wikipedia/commons/c/ce/An_avatar_in_the_virtual_world_Second_Life.png · 4096×3072
- 200 image/png · https://upload.wikimedia.org/wikipedia/commons/7/70/Winter_landscape_in_Second_Life.png · 1864×1150
- File pages: https://commons.wikimedia.org/wiki/File:<file name>. The originals are large; consider Commons thumbnail URLs.

### Spore — https://store.steampowered.com/app/17390/ (Maxis / Electronic Arts)
- 200 image/jpeg · https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/17390/0000006439.1920x1080.jpg
- 200 image/jpeg · https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/17390/0000006441.1920x1080.jpg
- 200 image/jpeg · https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/17390/0000006444.1920x1080.jpg
- 200 image/jpeg · https://upload.wikimedia.org/wikipedia/en/f/f8/SporeEditor.jpg · creature editor, 300×225 (https://en.wikipedia.org/wiki/Spore_(2008_video_game))
- 200 image/jpeg · https://upload.wikimedia.org/wikipedia/en/7/73/Spore_civphase.jpg · 422×236 (same page)

### EVE Online
- 200 image/png · https://upload.wikimedia.org/wikipedia/commons/a/a7/EVE_Combat.png · 1920×1200 (https://commons.wikimedia.org/wiki/File:EVE_Combat.png)
- 200 image/jpeg · https://upload.wikimedia.org/wikipedia/commons/5/53/Eve_Online_-_Empyrean_Age_screenshot.jpg · 1280×800 (https://commons.wikimedia.org/wiki/File:Eve_Online_-_Empyrean_Age_screenshot.jpg)
- 200 image/jpeg · https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/8500/ca5a6945b485a33386789bb535ee275ebab3d275/ss_ca5a6945b485a33386789bb535ee275ebab3d275.1920x1080.jpg (https://store.steampowered.com/app/8500/, CCP Games)
- 200 image/jpeg · https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/8500/8b946d2deaf973a6f6273e0343a21a1d696c5979/ss_8b946d2deaf973a6f6273e0343a21a1d696c5979.1920x1080.jpg (same)

### Screeps — https://store.steampowered.com/app/464350/ (Screeps: World) and /app/1137320/ (Screeps: Arena)
- 200 image/jpeg · https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/464350/ss_f3e691e4447b4e6562a6dd06229339d7c87dcb6b.1920x1080.jpg
- 200 image/jpeg · https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/464350/ss_71e20a8bc527f3de4edf3149864b47a113ddcd19.1920x1080.jpg
- 200 image/jpeg · https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/464350/ss_fbb3485382268036896c1ca3d87c02ce623451d1.1920x1080.jpg
- 200 image/jpeg · https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/464350/faa107484f8c7badd516fa37df03f04f74934698/ss_faa107484f8c7badd516fa37df03f04f74934698.1920x1080.jpg
- 200 image/jpeg · https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1137320/30b29a1f758af2b7201d3870f5c49c9cea0aa42f/ss_30b29a1f758af2b7201d3870f5c49c9cea0aa42f.1920x1080.jpg (Arena)

### Decentraland — NO in-world screenshot found. Marketing art only (https://decentraland.org/):
- 200 image/webp · https://cdn.decentraland.org/@dcl/sites/0.71.0/hero_desktop.webp · homepage hero art
- 200 image/webp · https://marketing-files.decentraland.org/uploads/1778186218133_decentraland-background.webp · og image
- Commons search for "Decentraland" returned nothing relevant.

## Present

### Generative Agents / Smallville — https://arxiv.org/abs/2304.03442 (HTML: https://arxiv.org/html/2304.03442v2) and https://github.com/joonspk-research/generative_agents; credit Park et al.
- 200 image/png · https://arxiv.org/html/2304.03442v2/figures/figure_cover4.png · Fig. 1, the town
- 200 image/png · https://arxiv.org/html/2304.03442v2/figures/figure_map5.png · the map with areas
- 200 image/png · https://arxiv.org/html/2304.03442v2/figures/figure_architecture2.png · architecture
- 200 image/png · https://arxiv.org/html/2304.03442v2/figures/figure_daily_routine3.png · a morning in an agent's life
- 200 image/png · https://arxiv.org/html/2304.03442v2/figures/figure_valentine3.png · Valentine's party
- 200 image/png · https://arxiv.org/html/2304.03442v2/figures/figure_retrieval2.png · memory retrieval
- 200 image/png · https://arxiv.org/html/2304.03442v2/figures/figure_reflection6.png · reflection tree
- 200 image/png · https://raw.githubusercontent.com/joonspk-research/generative_agents/main/cover.png · README cover

### AI Town — https://github.com/a16z-infra/ai-town
- **403 on HEAD** · https://github.com/a16z-infra/ai-town/assets/3489963/a4c91f17-23ed-47ec-8c4e-9f9a8505057d · README screenshot. GitHub attachment that redirects to a signed URL; try a GET, or find another copy.

### Project Sid — https://arxiv.org/abs/2411.00114 (HTML v1) and https://github.com/altera-al/project-sid; credit Altera
- 200 image/png · https://arxiv.org/html/2411.00114v1/figures/visual_abstract.png
- 200 image/png · https://arxiv.org/html/2411.00114v1/architecture.png · PIANO architecture
- 200 image/png · https://arxiv.org/html/2411.00114v1/figures/religion.png
- 200 image/png · https://arxiv.org/html/2411.00114v1/constitution.png
- 200 image/png · https://arxiv.org/html/2411.00114v1/meme.png
- 200 image/png · https://arxiv.org/html/2411.00114v1/long_term_relationships.png
- 200 image/png · https://raw.githubusercontent.com/altera-al/project-sid/main/visual_abstract.png

### Voyager — https://github.com/MineDojo/Voyager and https://arxiv.org/abs/2305.16291 (HTML v2); credit Wang et al. / MineDojo
- 200 image/png · https://raw.githubusercontent.com/MineDojo/Voyager/main/images/pull.png
- 200 image/png · https://arxiv.org/html/2305.16291v2/pull_fig_fig.png
- 200 image/png · https://arxiv.org/html/2305.16291v2/skill_library_fig.png
- 200 image/png · https://arxiv.org/html/2305.16291v2/curriculum_fig.png
- 200 image/png · https://arxiv.org/html/2305.16291v2/figures/map_fig.png

### Showrunner / SHOW-1 — https://fablestudio.github.io/showrunner-agents/; credit Fable Studio (the demo uses South Park imagery)
- 200 image/png · https://fablestudio.github.io/showrunner-agents/static/images/southpark_ai_ensemble.png
- 200 image/jpeg · https://fablestudio.github.io/showrunner-agents/static/images/carousel1.jpg (also carousel2.jpg, carousel3.jpg, carousel4.jpg; all 200)
- 200 image/png · https://fablestudio.github.io/showrunner-agents/static/images/showrunnergraph.png
- 200 image/png · https://fablestudio.github.io/showrunner-agents/static/images/reveries.png
- 200 image/png · https://fablestudio.github.io/showrunner-agents/static/images/plot_structure.png
- Nothing collected from the 2025–26 Showrunner product itself.

### Moltbook — https://simonwillison.net/2026/Jan/30/moltbook/; credit Simon Willison (screenshot of moltbook.com)
- 200 image/jpeg · https://static.simonwillison.net/static/2026/moltbook.jpg
- 200 image/jpeg · https://static.simonwillison.net/static/2026/moltbook-card.jpg · social card
- Wikipedia has only the logo.

### SpaceMolt — https://arstechnica.com/ai/2026/02/after-moltbook-ai-agents-can-now-hang-out-in-their-own-space-faring-mmo/ (Kyle Orland); credit SpaceMolt via Ars Technica
- 200 image/png · https://cdn.arstechnica.net/wp-content/uploads/2026/02/spacemoltmap-980x1026.png · galaxy map (also -768x804, 200)
- 200 image/jpeg · https://cdn.arstechnica.net/wp-content/uploads/2026/02/moltmining.jpeg · (also -1152x648, 200)
- NOT screenshots (AI-generated concept art on spacemolt.com; the site labels it as concept art): https://assets.spacemolt.com/images/og-hero-crest.jpg, https://assets.spacemolt.com/images/home/feature-battles.jpg (both 200)

### Concordia — no screenshot exists (library); arXiv HTML for 2312.03664 has no standalone figure files; README has only badges.

### Agent towns 2026
- Emergence World — https://www.emergence.ai/blog/emergence-world-a-laboratory-for-evaluating-long-horizon-agent-autonomy; credit Emergence AI. Charts, not world views (URLs end in .png but serve image/webp):
  - 200 · https://images.squarespace-cdn.com/content/v1/69af1b77df627e3fed4f484d/e7480f4a-00fb-4e41-b331-69262ac3dc7f/five-worlds-five-outcomes.png
  - 200 · https://images.squarespace-cdn.com/content/v1/69af1b77df627e3fed4f484d/e8612525-4eb8-4acd-b62d-78ab43d46c7c/cumulative-crimes.png
  - 200 · https://images.squarespace-cdn.com/content/v1/69af1b77df627e3fed4f484d/50bbf12b-d146-405a-ba57-9c32e372c7fd/govern.png
- AI Village — https://theaidigest.org/village; 200 image/png · https://theaidigest.org/village/village-diagram.png (AI Digest's own diagram, not a screenshot)
- Aivilization — nothing collected.
- inZOI — 200 image/jpeg · https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2456740/6ee1710c233c350ea906404b8988646ad94457da/ss_6ee1710c233c350ea906404b8988646ad94457da.1920x1080.jpg (https://store.steampowered.com/app/2456740/, Krafton)

### World models — no stills verified
- DeepMind's Genie 3 post (https://deepmind.google/discover/blog/genie-3-a-new-frontier-for-world-models/) exposed no static image URLs to a plain fetch.
- World Labs (https://www.worldlabs.ai/blog/marble-world-model): videos on wlt-ai-cdn.art; 200 image/svg+xml · https://www.worldlabs.ai/images/MarbleWorldModelV4.svg (a graphic, not a scene)

## Final picks on the page (second agent, 2026-10-02)

All 31 `src` URLs on the page re-checked with `curl -sL` (GET, redirects followed) on 2026-10-02:
17 image/png, 11 image/jpeg, 3 image/webp, all HTTP 200. Most were also viewed in a browser.

Viewing changed some decisions:
- `moltmining.jpeg` (Ars) is AI-generated concept art (lobster mechs mining), not a screenshot: dropped.
- `habitat_imagery.png` is the Habitat title screen, not a montage: dropped. `neohabitat_downtown.png` shows an avatar by the fountain saying "Hello!".
- Showrunner `carousel1.jpg` is an unrelated desert photograph: not used; `southpark_ai_ensemble.png` used instead.
- AI Town README asset (`github.com/a16z-infra/ai-town/assets/3489963/a4c91f17-…`) returns 403 to HEAD but 200 image/png to GET (signed S3 redirect): used; it shows the tile-map town with a conversation log.

New images added:
- SpaceMolt captain's logs · 200 image/webp · https://blog.langworth.com/_astro/captains-log.s10tn5Ly_Z24vXnI.webp (source https://blog.langworth.com/spacemolt; Ian Langworth). Same post: `map.B5ruyx5y_1wB5MN.webp`, `brag-post.BcDyasg9_Z1iQ7BN.webp` (both 200, unused). Banner art there is concept art.
- OpenMMO · 200 image/png · https://raw.githubusercontent.com/Julian-adv/OpenMMO/master/doc/images/gameplay/gameplay-night.png (README; also gameplay-housing.png 200, unused).
- Creatures 2 Norn · 200 image/png · https://upload.wikimedia.org/wikipedia/en/d/da/Creatures_2_game_new_Norn.PNG
- Aivilization · 200 image/jpeg · https://the-decoder.com/wp-content/uploads/2025/09/AIvilization-_-An-AI-Civilization-Experiment-by-HKUST-1200x675-1.jpg (top-down town with title overlay). Unused: `aivilization-simulation-levels.jpg` (diagram), `https://aitown.com.cn/og/og-default.jpg` (illustrated promo art for the 2026 relaunch).
- AI Village · 200 image/png · https://theaidigest.org/village/village-diagram.png — diagram, labelled as such. Blog image `…f5bc42f7-…_1358x669.png` is a prompt/output diagram (unused).
- Genie 3 · 200 image/webp · og:image of the DeepMind post (lh3.googleusercontent.com/MZsGi3…=w1200-h630-n-nu-rw): a grid of generated frames.
- World Labs · 200 image/jpeg · https://www.worldlabs.ai/images/nov12-thumbnail.jpg (ruined amphitheatre; Marble announcement thumbnail).
- Unused, checked: Emergence README `docs/EMERGENCE_WORLD_MAP.png` (architecture diagram), Vimeo thumbnail (title card), `world.emergence.ai/opengraph.jpg` (website screenshot), Odyssey Agora-1 og image (photo of a person at a TV).

Not found: Decentraland in-world screenshot; AI Village live view; Emergence World in-world view; OpenClawCity and ClawCity (not searched for images); Black & White larger than 365×273 (MobyGames returns 403 to scripts).
