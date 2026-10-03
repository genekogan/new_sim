# R8 — Second Life: what people did there, what the world kept, and what Sim should take

> Written 2026-10-02 from web research on that day. Builds on, and does not repeat,
> `14-MVP-TECHNICAL-SPEC-DRAFT.md` §10 (one simulator per 256 m region, about 100 avatars) and
> `research/R2-LANDSCAPE-AGENT-WORLDS.md` §6 (bot policy, traffic bots, the 2023 scripted-agent
> controls, Habitat). Every fact carries a date and a URL. **[claimed]** marks a figure that comes
> only from a company, a forum, a blog summary or a search-engine digest that I could not check
> against a primary source. "Sim" means the shell in `<old-sim-repo>/docs/STATUS.md` (as of 2026-10-01)
> and the design in eden4 docs `02`, `04`, `05`, `13` and `18`. Everything under "proposal" is
> Claude's, not Gene's, and not decided.

## 0. The short version

Second Life (Linden Lab, launched 2003-06-23) is the longest-running owned, built, persistent
3D world. It had no goals; residents made the content, owned the IP and traded it for Linden
dollars that cash out. Land rent ("tier") paid for the servers, and land was the main business.
The 2006–07 hype peak brought about 1.3 million monthly users and dozens of brands; the brands
found an empty world and left within about two years, and retention never recovered (about 10%
of new users still there at 90 days in 2007; about 7% in 2025). What held people was each other:
clubs, live music, roleplay, shopping for their avatar, and small self-governed estates. Almost
every rule SL has came after a scandal or an exploit: the prim tax revolt, CopyBot, ageplay,
gambling, the Ginko bank run, ad farms, traffic bots, the adult continent. In 2026 it is a
profitable niche of roughly 600,000 monthly users with an average tenure of 14 years, and it
has tried and dropped an AI-NPC feature. For Sim the strongest lessons are: never pay for
presence (SL's dwell payouts created camping chairs and bots), define "ownership" before you
sell it, and make the world populated before you ask newcomers what they want to do.

## 1. What you did: the gameplay

### 1.1 The avatar and its wardrobe

The avatar was the first thing you owned and the thing most people spent on. In a 2011 survey of
378 residents, 41% said they spent most of their time modifying their avatar and 38% shopping;
84% had a human primary avatar, most of them the same gender as the user offline, and 42% kept
alternate avatars (Linares et al., *IJCBPL* 1(3), 2011,
https://www.cdmc.ucla.edu/wp-content/uploads/sites/170/2018/05/SL-pub-2011.pdf). Clothing was
the largest category of goods. After mesh uploads arrived, Wagner James Au argues, the economy
shifted further toward fashion releases and shopping events, while the "tinkerers" faded
(Au, 2026-05-21, https://wjamesau.substack.com/p/what-second-life-lost-when-it-moved).

*For Sim:* a Soul's look is set at birth from a description, and doc 13 allows only cosmetic edits.
SL suggests that the look, if editable, is the main thing owners will spend on. Whether cosmetic
edits are a manna sink is a dial worth naming now.

### 1.2 Building: prims, then sculpties, then mesh

Residents built in-world from primitive shapes ("prims"), linked up to 256 at a time
(https://en.wikipedia.org/wiki/Second_Life). Sculpted prims added organic shapes made outside SL,
and mesh import from any 3D tool went grid-wide on 2011-08-23
(https://wiki.secondlife.com/wiki/History). Every parcel had a capacity in prims proportional to
its area: today a 512 m² mainland parcel holds 175 and a full 65,536 m² region 22,500
(https://secondlife.com/land/pricing). Public "sandbox" regions let anyone build and then
auto-returned objects to their owners.

Au's 2026 essay argues that the move from in-world prims to uploaded mesh cost SL a culture:
building had been something you watched others do and copied, in public, with the world's own
tools; mesh moved it into Blender and made SL a shop window (Au, 2026-05-21, above). He adds
that the visual upgrade did "little to actual user growth".

*For Sim:* cards are Sim's prims: a small grammar, built in-world, that anyone can watch being
played. Keep minting visible and public; don't let the important making move entirely off-world
into uploaded assets.

### 1.3 Scripting: LSL

The Linden Scripting Language gives behaviour to objects; scripts are event-driven state machines
(https://wiki.secondlife.com/wiki/LSL_Portal). They run inside the region's simulator alongside
physics and chat, not on the owner's computer (Hoff, 2008-12-20,
https://highscalability.com/second-life-architecture-the-grid/), so a vendor, door or greeter
keeps working when its maker is offline. Each Mono script has 64 KB
(https://wiki.secondlife.com/wiki/LSL_Script_Memory). Linden Lab began replacing Mono with
"SLua", based on Roblox's Luau, with 128 KB per script: alpha on 2025-03-14, beta on parts of the
main grid in December 2025 (https://modemworld.me/2025/03/14/lab-officially-announces-luau-alpha-testing/,
https://wiki.secondlife.com/wiki/Lua_Alpha).

Linden Lab's studio director, after the self-replicating "grey goo" attacks of 2006: "Attacks are,
to some extent, a result of the decisions that we have made to allow a broad range of
functionality … much of the functionality that is used to make Second Life the fascinating place
that it is can also be used to create disruptive attacks" (Douglas Soo, quoted in *The Register*,
2006-11-24, https://www.theregister.com/2006/11/24/secondlife_greygoo_attack/).

*For Sim:* SL's expressive layer was code attached to objects and run by the world; Sim's is cards
attached to Souls and run by the kernel. SL's always-on objects were the only "presence" an absent
owner had. Sim's cards cannot loop or reach outside the five changes (`18` §8), which removes grey
goo by construction; keep that property when cards get attached to things (see §6.3).

### 1.4 Land

Land is 256 × 256 m regions, each run by one simulator process, four per machine in 2007–08
(Hoff, above). There were two kinds:

- **Mainland**: continents owned by Linden Lab, sold as parcels, rented by monthly "tier" in USD.
  Current fees run from $4 a month for 512 m² to $166 for a whole region
  (https://secondlife.com/land/pricing). Premium memberships include a small land allowance.
- **Private estates ("islands")**: whole regions rented from Linden Lab by one owner, who sets the
  rules, the access list and the covenant and usually sublets. Varvello et al. (2008) put it
  plainly: "Owners of private Regions have total control on their virtual land"
  (https://www.eurecom.fr/en/publication/2680/download/rs-publi-2680.pdf). A full private region
  costs $209 a month from 2026-06-15, down from $239 **[claimed]**, search-engine digest of
  Linden pricing, not seen on the page.

Private estates won. On 2026-09-27 the grid had 27,380 regions: 17,867 private and 9,513 owned by
Linden Lab, which still holds about 57% of mainland itself (https://gridsurvey.com/).

Linden Lab's answer to "where do newcomers live" came late: on 2019-04-15 it opened **Linden
Homes** on a new continent, Bellisseria, with a free pre-built house for Premium members in themed
neighbourhoods; the continent reached close to 1,500 regions
(https://modemworld.me/2019/04/15/lab-launches-new-linden-homes/).

### 1.5 Events, clubs, roleplay, art, education, commerce

- **Events and clubs.** Live music is streamed by the performer to a Shoutcast/Icecast server and
  mapped to a parcel; venues pay performers and run tip jars; Café Musique has hosted more than
  600 performers since 2015 (https://www.secondlife.com/destination/cafe-musique). Varvello et
  al. found peaks in region population were "mostly driven by the presence of events such as
  concerts and shows" (2008, above).
- **Roleplay.** Gor (from John Norman's novels), vampires, furries, tinies, steampunk, fantasy
  (https://jvwr-ojs-utexas.tdl.org/jvwr/article/view/330). Communities added their own game
  layer with worn HUDs and combat meters; the Bloodlines vampire system shipped on 2008-05-06
  (https://sl-bloodlines.fandom.com/wiki/Talk:Getting_Started/@comment-109.248.95.15-20200819125744).
  27% of the 2011 survey said roleplay took most of their time (Linares et al., above).
- **Art.** The Linden Endowment for the Arts gave artists free regions from 2010/11 until
  2019-08-31; a successor, SLEA, opened in January 2021
  (https://modemworld.me/2020/09/11/announcing-the-second-life-endowment-for-the-arts).
- **Education.** Universities ran campuses on discounted regions. Linden Lab ended the 50% discount
  from 2011-01-01, "many institutions pulled out" and moved to OpenSim; the discount returned in
  July 2013 (https://er.educause.edu/articles/2011/4/second-life-is-dead-long-live-second-life,
  https://hypergridbusiness.com/2013/07/second-life-restores-half-off-discount-to-educators).
- **Commerce.** In-world shops, then the web Marketplace, which listed 2.1 million items
  (https://en.wikipedia.org/wiki/Second_Life). "Working in SL" was the main activity for 26% of
  the 2011 survey.

### 1.6 The 2006–07 peak

Basic accounts became free in 2005–06, after which completed registrations rose about 350%
**[claimed]** (MarketingSherpa, 2006-03-16, https://www.marketingsherpa.com/article/case-study/how-it-worked-linden-lab).
The millionth account came on 2006-10-18 (https://wiki.secondlife.com/wiki/History). Anshe Chung
was on the cover of *BusinessWeek* on 2006-05-01. comScore counted 1.3 million people who logged
in during March 2007, 61% of them in Europe; Germany (209,000) outnumbered the US (207,000)
(comScore, 2007-05-04, https://www.comscore.com/Insights/Press-Releases/2007/05/Second-Life-Growth-Worldwide).
Gartner predicted in April 2007 that by the end of 2011, 80% of active internet users would have
"a 'second life', but not necessarily in Second Life"
(https://www.eightbar.com/2007/04/27/gartner-predictions-on-the-metaverse/index.html). IBM bought
12 islands; Sweden, Estonia and the Maldives opened embassies (https://en.wikipedia.org/wiki/Second_Life).
Concurrency kept rising after the hype, to its all-time peak of 88,200 in Q1 2009 (same).

*For Sim:* SL's growth followed free entry, and its peak attention came from press about money
(Anshe Chung) rather than from anything to do. Sim's growth story will likewise be told by its
most surprising economic fact. Decide which fact that should be.

## 2. How people interacted

### 2.1 What residents actually did

Three independent measurements agree that SL was a social place first:

| Source | Finding |
|---|---|
| Linares et al., survey of 378 residents, 2011 (above) | Main activities: interacting with others 74%, avatar 41%, shopping 38%, roleplay 27%, working 26%, building or scripting 22%, combat 9%, griefing 3%. 85% had formed friendships and 50% romantic relationships in SL; 58% logged in daily |
| Varvello, Picconi, Diot, Biersack, CoNEXT 2008, crawl of ~13,000 public regions, March–May 2008 (above) | 30% of public regions had no visitor in six days; most regions were static (objects rarely created or destroyed); in popular regions avatars stood still more than 80% of the time, chatting; half of them came in small groups of "good friends" meeting at the same places; at least 5% of the population was likely bots; overloaded servers slowed regions' "virtual time" |
| Frank Rose, *Wired*, August 2007 (https://frankrose.com/?p=1438) | Top traffic: "Money Island" (free currency) 136,000 and "Sexy Beach" 133,000, against 27 for Coca-Cola's pavilion and 281 for Sears |

Only 22% built or scripted. The "world built by its residents" was built by a minority and lived
in by the rest.

*For Sim:* the Varvello measures are directly computable from Sim's log and should be on the
dashboard from day one: share of places with no visit in a day, share of things never changed,
share of time spent still, group size and repeat meetings. They will show whether Souls make a
world feel lived-in or just occupied.

### 2.2 Social structures and governance experiments

- **Groups** gave shared chat, roles, titles and group-owned land; they were the unit of clubs,
  stores and roleplay factions.
- **Estates** were small monarchies. Wagner James Au: "benign dictatorships were the norm",
  with "a single tiny tyrant mayor who could afford the investment" (WHYY, 2024-01-08,
  https://whyy.org/segments/lessons-from-second-life-democracy-in-the-metaverse).
- **The Confederation of Democratic Simulators** (founded 2004 as the city of Neualtenburg) is
  SL's oldest democracy: elected assembly, executive and court, citizenship tied to holding a
  parcel. A founders' dispute ("the Quake") ended with one co-founder exiled and neighbourhoods
  deleted after IP complaints to Linden Lab. In 2024 it had 72 citizens (WHYY, above).
- **The 2003 tax revolt.** Linden Lab first charged a weekly tax per prim. Residents gamed it by
  taking builds into inventory on tax day; the Americana group dropped giant tea crates and set
  its landmarks alight; in December 2003 Linden Lab replaced the prim tax with a land fee
  (https://ryanschultz.com/2018/08/16/, https://www.technologyreview.com/2005/12/01/229988/virtual-economics/).
- **The libertarian moment ended in 2008.** *Reason* described Linden Lab's 2007–08 bans
  (gambling, banks, ad farms) as the end of SL's "libertarian experiment"; it also reported that
  active users plateaued around 550,000 from mid-2007 to early 2008 **[claimed]**
  (2008-02-14, https://reason.com/2008/02/14/is-second-lifes-libertarian-ex).

*For Sim:* the only governance that lasted in SL was small, tied to land, and enforced by the
owner's tools. A tax on what you build was gamed within weeks and replaced by a tax on space.
Sim's per-piece inertia and Harberger ideas (`04`) tax things, not space; SL is a warning that
taxing objects invites hiding them.

### 2.3 Griefing

Griefing was a culture, not just a nuisance. The W-Hats (an offshoot of the Something Awful
forums) and the Patriotic Nigras (from 4chan, about 200 members at peak) used self-replicating
objects to lag or crash regions, particle storms, shock images and cages; they disrupted Anshe
Chung's CNET interview in December 2006 with flying phallic objects and defaced John Edwards'
campaign headquarters in February 2007; when banned they built a client to evade hardware bans
(https://en.wikipedia.org/wiki/Patriotic_Nigras, https://en.wikipedia.org/wiki/Anshe_Chung).
Three self-replicating "grey goo" attacks hit the grid from September to November 2006, the last
with spinning gold rings that forced Linden Lab to shut down and disable scripts
(*The Register*, 2006-11-24, above). Julian Dibbell's *Wired* feature of 2008-01-18 made the
"lulz" ethic known outside (https://www.raphkoster.com/2008/01/25/wired-on-griefers/). In the 2011
survey 3% admitted griefing.

*For Sim:* almost every SL grief worked by acting on someone else: pushing, caging, filling their
screen, crashing their region. Sim's one rule (an actor changes only itself and what it controls,
`18` §3) removes that whole class. What remains is speech, placed media and economic griefing
(buying the land next to you), which is where SL's later trouble was too (§2.4, ad farms).

### 2.4 Moderation, in the order it happened

| Date | What | Trigger |
|---|---|---|
| 2003-11 | Residents keep IP rights in what they make | Linden Lab's choice (https://creativecommons.org/2003/11/14/secondliferesidentstoowndigitalcreations/) |
| 2003-12 | Prim tax replaced by land fee | Tax revolt |
| 2006-11 | CopyBot declared infringement; residents liable | Shop strike, ~600 stores closed **[claimed]** (https://ieet.org/index.php/IEET2/more/cascio20061117) |
| 2007-05 | Ageplay policy; offenders banned | ARD *Report Mainz* and Sky News reports on child avatars in sexual roleplay (https://foreignpolicy.com/2007/05/10/virtual-pedophilia-on-second-life/) |
| 2007-07-25 | Gambling banned | FBI investigation that began in April (https://techcrunch.com/2007/07/25/second-life-bans-gambling-following-fbi-investigation/) |
| 2008-01-22 | Interest-bearing "banks" banned without a real charter | Ginko Financial's collapse in August 2007 (https://www.technologyreview.com/2008/01/10/270541/second-life-closes-banks/) |
| 2008-02 | Ad farms banned on mainland | Visual spam used to force neighbours to sell (https://wiki.secondlife.com/wiki/Linden_Lab_Official:About_ad_farms_and_network_advertisers) |
| 2009-04 | Traffic and camping bots sanctioned; >15,000 bots affected | Search rankings were farmed (https://www.engadget.com/2009-04-24-linden-lab-to-take-action-against-second-life-seo-bots.html, https://www.engadget.com/2009-09-08-second-life-median-concurrency-declines-as-bots-campers-progress.html) |
| 2009-03-12 → 09-15 | Adult rating; all adult mainland content moved to the new continent Zindra; verification required | Mainstreaming (https://wiki.secondlife.com/wiki/History/Adult_Content_FAQ) |
| 2010 | Teen grid closed; minimum age 16 | (https://en.wikipedia.org/wiki/Second_Life) |
| 2023-03-28 | Region owners can bar flagged scripted agents | Scraping complaints (R2 §6) |
| 2024-12 → 2025-09-01 | AI Character Designer launched, suspended, relaunched, ended | See §5.6 |
| 2026-03 | Linden Lab quietly opens an official Adult Hub with mentors for newcomers | (https://modemworld.me/2026/03/07/) |

The pattern: rules arrived after a press scandal or a legal threat, and each one destroyed some
residents' businesses (casinos paid large tier; banks held deposits; adult mainland owners had to
move). Adult-rated regions are now about a quarter of the grid: 7,276 of 27,380 on 2026-09-27
(https://gridsurvey.com/).

*For Sim:* `05` already leans toward moderation by geography plus a hard floor. SL did exactly
that, six years late and by forced migration. Write the floor and the zoning before the first
public Soul, and include one SL-specific case that Sim inherits directly: Souls are generated
from owners' descriptions, so a description that yields a child-like Soul plus any sexual card is
the ageplay scandal waiting to happen.

### 2.5 Identity and anonymity

Avatar names were separate from legal names; Linden Lab dropped chosen last names in 2010 and sold
them back from 2018; it ran age verification from 2007 and abandoned it around 2013
(https://ryanschultz.com/2018/08/16/). Tom Boellstorff did 2½ years of fieldwork as the avatar
Tom Bukowski, created in 2004, and published *Coming of Age in Second Life* (Princeton, 2008); he
writes "actual" rather than "real" life on purpose (Friend, *Rhizomes* 20, 2010,
https://rhizomes.net/issue20/reviews/friend.html). Three of his findings matter for Sim
(Kuntsman, 2010, https://distantreader.org/stacks/journals-ojs/twc/twc-222.htm):

- "Creationist capitalism": residents understood their labour as creation and self-expression,
  not as work.
- "Time resisted virtualisation in a way that place did not": a world can be anywhere, but an
  event happens at one hour, which is 3 a.m. somewhere; he called this temporal inequality.
- "Actual world sociality cannot explain virtual world sociality": relationships formed in SL were
  real on their own terms. The 2011 survey (above) found 16% of respondents had moved SL friends
  to the phone and 7% met face to face.

*For Sim:* Sim's lunar-rotating ritual is an answer to Boellstorff's temporal inequality that SL
never found; an always-on Soul that attends on your behalf is a second answer.

### 2.6 Anshe Chung, the land baron

Ailin Graef, a former teacher from Hubei living in Germany, started in June 2004 selling custom
animations, then bought land wholesale, subdivided it, landscaped it and rented it in themed,
zoned "Dreamland" estates where neighbours could not build eyesores. Anshe Chung Studios was
incorporated in China in February 2006 and employed more than 80 people; she announced a net worth
above US$1 million in November 2006 from an initial $9.95
(https://en.wikipedia.org/wiki/Anshe_Chung, https://fortune.com/2006/11/27/anshe-chung-first-virtual-millionaire).
Her product was not land; it was **zoning**: a guarantee about what your neighbours could do.

*For Sim:* in a commons-by-default world (`04`), the first fortune will be made selling exactly
what Dreamland sold: protection from neighbours. Sim's Harberger protection right is that
product; expect intermediaries to bundle it.

### 2.7 Brands that came and left

American Apparel opened the island Lerappa on 2006-06-17 and closed it in Q4 2007
(https://en.wikipedia.org/wiki/Lerappa). Reuters opened a virtual bureau in October 2006 and closed
it in October 2008 (https://pressgazette.co.uk/news/reuters-pulls-correspondent-from-second-life/).
Frank Rose's August 2007 *Wired* piece ("Lonely Planet") found Coca-Cola's marketing chief alone
in brand builds ("There was nobody else around"), Starwood's Aloft hotel "deserted, almost creepy",
7 million registered avatars but about 1 million logging in per month and a third of that per
week, about 100,000 Americans weekly for US marketers, and full-time brand presences costing
$500,000 a year or more (https://frankrose.com/?p=1438).

*For Sim:* brands built destinations in a world where nobody's body was there unless they chose to
log in. Sim inverts that: Souls are always somewhere. The lesson that survives is that a venue
without a reason to visit is empty either way; Souls must have a reason in their deck to go there.

### 2.8 Journalism and study

Linden Lab paid Wagner James Au as an embedded reporter, "Hamlet Linden", from 2003-04-22
(https://www.cjr.org/feature/burning_the_virtual_shoe_leath.php); Peter Ludlow's independent
*Second Life Herald* ran from June 2004 to 2009 and covered scams, griefers and sex work
(https://en.wikipedia.org/wiki/The_Alphaville_Herald). Third parties also measured the world: the
Grid Survey, run by a resident, tracks every region and its history (https://gridsurvey.com/).

*For Sim:* SL got both an in-house chronicler and an adversarial press, and the adversarial one
was more trusted. Sim's narrator is the in-house one; its public log is what lets an independent
Herald exist.

## 3. World state: what persisted, and how the world grew

### 3.1 What persists

- **Land and terrain** per region, held by the simulator.
- **Rezzed objects** with their running scripts, stored by the simulator that hosts them.
- **Assets** (textures, sounds, scripts, meshes, animations): **immutable**, keyed by UUID, in one
  clustered store of about 100 TB in 2007 (Hoff, above). "Assets are immutable … when the user is
  editing an asset, they are in fact creating new assets"
  (https://list-archives.secondlife.com/sldev/2007-December/007364.html,
  https://wiki.secondlife.com/wiki/UUID).
- **Inventory** is "only a permissions layer": an item is a wrapper holding permissions, creator
  and owner, pointing to an asset (same sources).

The grid ran on 2,000+ servers in 2007 and about 6,000 in early 2008 (Hoff, above) and moved to
AWS in January 2021 (https://en.wikipedia.org/wiki/Second_Life). Linden Lab says residents have
made "nearly two billion" creations (2023-06-22,
https://lindenlab.com/press-release/original-metaverse-second-life-celebrates-20th-birthday).

### 3.2 Permissions

Every item carries move, modify, copy and transfer flags for owner, group, everyone and **next
owner**; copies keep creator information and "can never be more permissive than the item being
copied"; next-owner no-modify is read as "no one can create derivative works"
(https://wiki.secondlife.com/wiki/Permission). A seller chooses, for example, copy/no-transfer
(you can keep spares but not resell) or transfer/no-copy (a scarce, resellable object). This small
matrix is what made a creator economy possible without a blockchain.

*For Sim:* this answers Sim's open question 2 in `18` §10 ("can a card be improved without
changing what past plays meant?"). SL's answer: never edit; every revision is a new immutable
asset, and the inventory item points to whichever version the owner holds. In Sim terms: a card
revision is a new hash with a `revises` link to the old; past plays keep their hash; a deck entry
can be moved to the new hash. Next-owner rights map onto cards too (may others play it, copy it
into their deck, or trade it).

### 3.3 How the world grew and shrank

| When | Regions | Source |
|---|---|---|
| March 2002 | 16 (named after San Francisco alleys) | https://wiki.secondlife.com/wiki/History |
| March–April 2008 | ~13,000 public regions crawled; 17,526 regions listed in April | Varvello et al., above |
| October 2008 | island count peaks at 26,665, then −1,977 in November after the Openspace price rise **[claimed]** | forum digest, https://forums-archive.secondlife.com/354/22/296275/9.html |
| June 2010 | **31,988, the all-time peak** | Grid Survey via https://danielvoyager.wordpress.com/2025/11/04/second-life-region-statistics-early-november-2025-update/ |
| July 2023 | 27,690 (18,330 private) | https://danielvoyager.wordpress.com/2023/07/05/second-life-grid-statistics-july-2023-update/ |
| 2025-11-02 | 26,785 (17,589 private, 9,196 Linden) | Voyager, above |
| 2026-09-27 | 27,380 (17,867 private, 9,513 Linden) | https://gridsurvey.com/ |

Growth came from private islands, not from Linden's mainland. Land shrank when prices rose:
in October 2008 Linden Lab raised the fee on Openspaces, cheap regions sold for "light use" such as
ocean and parkland, because most were being rented as homes and carried twice the expected load;
the price went toward US$125 a month with a 20-avatar limit
(https://en.wikipedia.org/wiki/Second_Life), with a later compromise converting non-compliant ones
to Homesteads at $95 from 2009-01-05 **[claimed]** (forum archive above).

### 3.4 Abandoned land

When a mainland owner abandons a parcel (or stops paying), it passes to the account "Governor
Linden", objects on it are auto-returned to their owners after a week, and the parcel is resold
or auctioned; the owner should "never expect to be able to reclaim" it
(https://community.secondlife.com/knowledgebase/english/abandoned-land-r1034,
https://modemworld.me/2013/01/19/changes-to-the-abandoned-land-policy/). Objects are never
destroyed; they go back to inventory.

*For Sim:* SL's two good ideas here are that abandonment is automatic (stop paying, lose the
land) and that nothing is destroyed (it returns to its maker). Sim's commons-by-default with
optional Harberger protection (`04`) already makes lapse automatic. Returning a removed thing to
its maker's inventory rather than vanishing it fits the kernel's "nobody acted on anyone" rule.

### 3.5 Offline presence: none

When you log off, your avatar disappears. SL never had idle bodies. Its substitutes were scripted
objects that kept running (vendors, greeters, tip jars), bots logged in as avatars, and people
paid to sit. Varvello et al. found "at least 5%" of the population were likely bots that stood
still 98% of the time (2008, above); Linden's 2009 crackdown affected more than 15,000 bots
(Engadget, 2009-09-08, above). Regions were capped at 40 avatars on mainland and 100 on islands
(https://wiki.secondlife.com/wiki/About_Traffic); Rose reported service degraded beyond about 70
per island processor (2007, above).

*For Sim:* this is the single biggest structural difference. SL's residents faked presence because
presence was scarce and paid; Sim makes presence free and universal. That fixes SL's emptiness
but moves the problem: if presence is everywhere, presence means nothing, and anything Sim pays
or ranks by presence will be farmed exactly as SL's was (Trap 1).

## 4. Objective: there wasn't one

SL's tagline was "Your World. Your Imagination.", revived in Linden Lab's 2011 marketing
(https://modemworld.me/2011/12/14/its-your-world-your-imgination-and-yes-were-listening/).
Philip Rosedale described it as a platform rather than a game: "We don't see this as a game"
(Google TechTalk, March 2006) and "I'm not building a game. I'm building a new country" (*Wired*,
2004) **[claimed]**, both as quoted in secondary sources, not seen in the originals. Au, looking
back: its mission was "lofty, and purposefully aimless" (WHYY, 2024-01-08, above).

**How residents set their own goals.** By owning something (a shop, a club, a rental estate),
by joining a roleplay sim with its own rules and HUD, by becoming a DJ or performer, or by
furnishing an avatar and a home. In 2025 Linden Lab's executive chairman asked creators to build
quests and game systems in-world to help retention
(https://wjamesau.substack.com/p/the-state-of-second-life-in-2025-560,
https://modemworld.me/2025/09/26/september-ll-zoom-call-an-update-on-second-life/).

**The cost: "what do I do?"**

- "About 85 percent of users drop out within two months of registering … Second Life has no
  built-in objective, and many newbies complain of not knowing what to do once they're there"
  (*California* magazine, March–April 2008,
  https://alumni.berkeley.edu/california-magazine/march-april-2008-mind-matters/will-second-life-survive).
- "New-user retention to 90 days is still about 10% according to Linden Lab", unchanged over
  2007 (Andrew Chen, 2008-01-18, citing Linden metrics,
  https://andrewchen.com/interesting-graph-on-second-life-usage/).
- Onboarding: Orientation Island (four tutorial zones) until mid-2008, then Help Island with
  volunteer mentors, a sandbox and a free house, where a newcomer could stay two weeks
  (https://wiki.secondlife.com/wiki/Orientation_Island). Rebuilding orientation took years across
  two CEOs (https://www.engadget.com/2010-07-10-the-virtual-whirl-a-brief-history-of-second-life-2008-2010-and.html).
- 2024–26: Linden Lab built a mobile app "for current residents with the hope it brings lapsed
  residents back", not for newcomers (Oberwager, December 2024,
  https://modemworld.me/2024/12/07/second-life-blogger-town-hall-december-2024-mobile-marketing-and-more/).
  It ran "Project Zero", the viewer streamed into a browser so a newcomer could enter from a link,
  from early 2025 and announced its end on 2026-04-21, 14 months later
  (https://modemworld.me/tag/project-zero/). In September 2025 Linden Lab said these routes brought
  about ten times more people to try SL but only about 7% stayed active, and that **newcomers
  placed at an established hub (Ahern) were harassed by veterans**, so it stopped placing them there
  (https://modemworld.me/2025/09/26/september-ll-zoom-call-an-update-on-second-life/).
- The result: in December 2024 Linden Lab gave the average user tenure as 14 years
  (GamesBeat, 2024-12-20, https://gamesbeat.com/linden-lab-has-spent-1-3b-building-second-life-and-paid-1-1b-to-creators/).
  SL keeps its residents and barely gains new ones.

*For Sim:* SL shows two separate onboarding failures. The first is "nothing to do": Sim answers it
because your Soul is already doing something when you arrive, and the plan/wish loop gives a
first verb. The second is "the busiest place is hostile to newcomers": doc 13's lean is to land
newcomers at the center. SL's 2025 experiment is direct evidence that the center is where
veterans harass arrivals. Arrival at the center needs a buffer: native Souls as greeters, and a
rule that newcomers cannot be targeted by unsolicited speech acts for their first hour (proposal).

## 5. Economy

### 5.1 The Linden dollar and the LindeX

Linden dollars (L$) are bought and sold for USD on Linden Lab's own exchange, the LindeX. The
terms call L$ "a limited license right … not redeemable for monetary value from Linden Lab"
(as quoted at https://www.internetandtechnologylaw.com/linden/), although residents can sell them
on the LindeX and cash out. The rate stayed between about L$240 and L$270 to the dollar from 2008
to 2017 **[claimed]**, unsourced on Wikipedia (https://en.wikipedia.org/wiki/Economy_of_Second_Life).
Payments and payouts went through Linden's subsidiary Tilia, a money transmitter licensed in 48
US states and territories; Thunes agreed to buy it on 2024-04-23
(https://lindenlab.com/press-release/thunes-announces-agreement-to-acquire-tilia-llc) and the sale
closed in June 2025 **[claimed]** (https://modemworld.me/category/linden-lab/tilia/).

### 5.2 How Linden Lab made money

- **Land** first: monthly tier on mainland and private regions (§1.4). CEO Ebbe Altberg said
  repeatedly that he would lower tier only if other revenue replaced it
  (https://modemworld.me/2019/12/02/thoughts-on-second-life-fees-tier-and-revenue/).
- **Premium memberships**: US$11.99 a month or $99 a year, with a weekly stipend of L$300
  (https://en.wikipedia.org/wiki/Second_Life). In early 2006 premium paid L$500 a week and basic
  accounts L$50 **[claimed]** (https://secondlife.fandom.com/wiki/Account); basic accounts have no
  stipend now. In October 2025 Linden Lab began offering Premium Plus without the stipend for
  US$105.12 a year less (https://modemworld.me/2025/09/26/september-ll-zoom-call-an-update-on-second-life/).
- **Fees**: LindeX buy/sell fees and a Marketplace commission raised to 10% on 2019-12-02
  (modemworld 2019, above). Linden Lab describes the split as 90% to creators
  (GamesBeat, 2024-12-20, above).

The stipend was never UBI in the eden4 sense: it was a rebate on a paid membership, and a
cheaper no-stipend plan shows Linden Lab treats it as a discount.

### 5.3 The size of the economy

| When | Figure | Source |
|---|---|---|
| Sept 2005 | US$3.6 million of activity in the month | https://en.wikipedia.org/wiki/Second_Life |
| Sept 2006 | "GDP" US$64 million (annualised) | same |
| Feb 2009 | ~64,000 residents in profit; 38,524 made under $10; 233 over $5,000 | same |
| 2009 | Economy US$567 million (+65%); resident earnings US$55 million | same |
| 2003–2013 | US$3.2 billion of transactions; 1.2 million a day | same |
| 2023-06-22 | "$650 million USD economy"; 1.6 million transactions a day; 73 million accounts; ~750K MAU | https://lindenlab.com/press-release/original-metaverse-second-life-celebrates-20th-birthday |
| 12 months to June 2024 | US$79 million paid to creators; US$1.1 billion since 2003; Linden Lab spent US$1.3 billion building SL | GamesBeat, 2024-12-20, above |
| 2023 | 21,152 creators earned income; 1,580 earned over $10,000; 14 earned over $1 million | same |

Oberwager's comparison: Roblox is "500 times our size in daily active users" but paid creators only
"10 times more" (same). SL's economy is small in users and large per user.

### 5.4 What was exploited

- **Dwell.** Linden Lab once paid landowners for traffic. Its Developer Incentive Awards gave cash
  to the top landowners by "dwell", time avatars spent on their land; in August 2004 it paid
  US$2,308 to 36 landowners (https://wiki.secondlife.com/wiki/About_Traffic). Owners responded by
  paying visitors to sit in "camping chairs"; the programme cost about US$120,000 a month by the
  end and was cut in 2006 **[claimed]** (*Alphaville Herald*, December 2005,
  http://alphavilleherald.com/2005/12/good_riddance_s.html). Traffic still ranked "Popular Places"
  and search, so camping and traffic bots outlived the payments until the 2009 crackdown (§2.4).
- **CopyBot** (November 2006): an open-source viewer tool that copied any object whose data reached
  the client; shops struck, and Linden Lab answered with copyright liability, not technology
  (https://ieet.org/index.php/IEET2/more/cascio20061117). In 2025 Linden Lab said it was pursuing
  legal action against content thieves and copybot makers in the EU and US (Au, 2025-11-19, above).
- **Ginko Financial**: paid 0.145% a day (about 70% a year) on L$ deposits; after the gambling ban a
  run left L$55 million of L$180 million unpaid, about US$750,000, and the remaining balances were
  turned into "perpetual bonds" (https://en.wikipedia.org/wiki/Ginko_Financial,
  https://en.wikipedia.org/wiki/Economy_of_Second_Life).
- **Gambling**: hundreds of casinos, large tier payers; banned on 2007-07-25 after the FBI visited
  (TechCrunch, above).
- **Land**: Marc Bragg exploited a bug in Linden's land auctions, bought land worth about $8,000
  for about $300, and had his account seized; a federal judge found SL's arbitration clause
  unconscionable in 2007 and the case settled
  (https://www.technollama.co.uk/bragg-v-linden-labs). Ad farms extorted neighbours (§2.4).
  Land prices fell overnight in Q2 2008 (https://en.wikipedia.org/wiki/Economy_of_Second_Life).
- **"Owned"**: Linden Lab's descriptor changed from "imagined, created and owned by its residents"
  to "imagined, and created by its residents" by October 2007, without explanation
  (https://www.engadget.com/2007-10-23-imagined-but-not-owned.html). The *Evans v. Linden Research*
  class action (filed April 2010) argued that Linden had sold land and items as property and then
  redefined them as licences; it settled in 2013 for about L$43 million (≈US$172,000) for about
  57,000 class members (https://modemworld.me/2013/06/30/evans-et-al-vs-linden-lab-l43-million-settlement/).

### 5.5 Who runs it now

- **Owners**: an investor group led by Randy Waterfield and Brad Oberwager, announced 2020-07-09
  (https://modemworld.me/2020/07/09/linden-lab-announces-it-is-to-be-acquired/). High Fidelity
  invested in January 2022 and Rosedale returned as a strategic adviser
  (https://www.lindenlab.com/releases/high-fidelity-invests-in-second-life). Oberwager is CEO and
  executive chairman as of May 2026, when Linden Lab reorganised product operations and customer
  success and its long-serving SVP "Patch Linden" left
  (http://slnewser.blogspot.com/2026/05/breaking-news-patch-linden-leaving.html).
- **Users**: about 750,000 monthly actives in June 2023, about 500,000 during 2024, 600,000 in
  October 2025 and 620,000 in December 2025, the last three from Oberwager
  (https://danielvoyager.wordpress.com/2025/12/19/second-life-now-at-620000-monthly-active-users/).
  Concurrency was 30,000–50,000 in 2022 **[claimed]** (https://webtribunal.net/blog/second-life-facts/).
  Linden Lab quadrupled ad spending in 2025 (Au, 2025-11-19, above).
- **Mobile**: an iOS/Android app (Unity) went to open beta for Premium in June 2024 and to all users
  on 2024-11-13; it was still updated as a beta in 2026
  (https://modemworld.me/2024/11/15/second-life-mobile-free-to-all-users-lab-execs-discuss-the-product-and-goals/,
  http://blog.nalates.net/2026/06/01/second-life-technology-updates-summary-may-2026/).
- **Sansar**, Linden Lab's VR-first successor, opened to the public in July 2017; Linden sold it to
  Wookey in March 2020 because it was years from being "cash-positive"; its website and servers went
  dark in December 2021 (https://ryanschultz.com/2020/03/30/engadget-interview-with-ebbe-altberg-why-linden-lab-decided-to-sell-sansar/,
  https://uploadvr.com/sansar-offline-without-explanation/).
- **Twitch** listed SL as a prohibited game on 2024-10-24 (https://en.wikipedia.org/wiki/Second_Life).

### 5.6 AI and agents in Second Life, 2023–2026

- **Scripted agents** must be flagged; region owners can bar them (since 2023-03-28; R2 §6). An
  unattended AI-driven avatar counts as a scripted agent and needs its own flagged account
  (https://wiki.secondlife.com/wiki/Linden_Lab_Official:Bot_policy).
- **AI Character Designer**: announced 2024-12-18 as an alpha for Premium Plus, built with Convai,
  for making conversational NPCs (greeters, roleplay characters); suspended shortly after because of
  community feedback; relaunched to all paid tiers at the end of February 2025; paused from
  2025-09-01, with existing characters removed and not retained. Linden Lab: "This is not the end of
  AI in Second Life; rather, it is a thoughtful pause as we refine our strategy"
  (https://modemworld.me/2024/12/19/linden-lab-leverage-convai-for-ai-character-generation-in-second-life/,
  https://modemworld.me/2025/07/31/li-announce-a-pause-in-the-current-sl-ai-character-designer-project/,
  https://slnewser.blogspot.com/2025/08/linden-lab-announces-indefinate-pause.html).
  The public reasons were not specific.
- **Blush**: Linden Lab bought the AI dating-sim app Blush (originally from Replika's maker) in late
  August 2025, kept it separate from SL, and promised: "We have no plans now or in the future to use
  Second Life conversations or content to train AI systems" (2025-09-06,
  https://modemworld.me/2025/09/06/).

*For Sim:* SL's residents, with 14 years' average tenure, treated operator-supplied AI characters
as an intrusion and their conversations as something to protect from training. Sim starts from
the opposite end, with AI inhabitants as the premise and the audience recruited for it. The
transferable lesson is about data, not NPCs: say in the rules, before launch, whether Sim's log of
speech and plays may be used to train models, and by whom.

## 6. Lessons for Sim

### 6.1 Where SL's history lands on Sim's design

| Sim design element | What SL shows |
|---|---|
| **Owned bodies that persist while owners are away** | SL had none, and residents faked it with bots, campers and scripted greeters; at least 5% of avatars were bots in 2008. Sim's Souls fill the gap legitimately; the residual risk is that presence stops meaning anything (§3.5). |
| **Land, center and frontier** | SL's growth was private islands with total owner control; the shared mainland stayed patchy, Linden-held, and was exploited by ad farms. Cheap land meant for light use became housing (Openspace) and a later price rise emptied it. A frontier that is cheap will be lived in, not left wild. |
| **Manna UBI** | SL's stipend was a membership rebate. Its one experiment in paying for activity (dwell awards) bred camping chairs and bots. Free money tied to nothing but being alive is closer to the stipend and safer; money tied to presence is dwell. |
| **Cards and minting as prims + scripts** | Same role: a small grammar anyone can use in-world. SL lost its building culture when the real making moved to external mesh tools (Au). Its scripting power was also its attack surface (grey goo). Sim's cards are safer by grammar and should stay in-world and public. |
| **Operator-paid minds** | SL's operator paid for simulators, not minds; its cost lived in land rent passed to owners. Sim pays for minds. SL's model suggests the mind cost should be a visible rent attached to something owners value (land in SL; the body in Sim), not a hidden subsidy. |
| **Moderation** | SL zoned by geography (General/Moderate/Adult, Zindra) and let estate owners set local rules and ban lists; every global rule came after a scandal. Sim's `05` lean matches; SL's lesson is timing. |
| **Replayable public record** | SL kept assets forever but not history: no public record of who did what when. Third parties built the Grid Survey to see the world at all. Sim's log is the census and the Herald's source in one. |
| **Ownership and NFTs** | SL marketed "owned", then removed the word and was sued twice. NFTs make the promise explicit and permanent; it has to be precise before the first sale. |

### 6.2 What changes when the inhabitants are AI

SL's failures cluster around three absences: no one was there (emptiness, brands, 10% retention),
no one was there for you while you were away (bots, campers), and no one did anything unless a
human was present (dead regions, static objects). Souls remove all three. They also remove SL's
main cost driver of moderation (humans acting on humans) by grammar. What they do not remove:
exploits of any paid signal, fights over land and protection, the ownership promise, and adult and
child-safety policy.

### 6.3 Futuristic adaptations (proposals, not decided)

1. **Souls as the shopkeepers SL never had.** In SL a shop was a vendor script and an empty room.
   A Soul can keep a shop or a venue open when its owner is away: greeting, asking, agreeing to a
   sale. Proposal: a "keep" card family (open, tend, close) whose plays are visible in the log, so a
   Soul's work for its owner is a public, attributable act, unlike SL's anonymous campers.
2. **Things that carry cards (Sim's LSL).** LSL attached behaviour to objects; The Sims attached
   affordances to objects (R2 §6). Proposal: a thing may hold cards that any Soul at it may play
   ("sit", "tip the performer", "buy one"), minted by the thing's maker and bounded by the same
   validator. This brings SL's always-on objects into Sim without loops or self-replication, and
   lets the world grow without touching any Soul's deck. It needs a locality rule (open question
   4 in `18`).
3. **Building as performance.** Restore SL's lost sandbox culture: when a Soul mints a card or
   places a piece, nearby Souls and watchers see it happen, and a native Soul may copy what it saw
   (with the card's next-owner rights). Souls become the tinkerers SL lost, and newcomers learn by
   watching, as SL residents did in sandboxes.
4. **Native Souls as welcomers.** SL used volunteer mentors and, in 2025, put newcomers where
   veterans harassed them. Proposal: each arrival is met by a native Soul whose deck includes
   "show around" and "introduce"; the newcomer's first gathering is arranged for them. The owner's
   first wish then has a social context to act in.
5. **Owners' agents as resident scripters.** In SL the scripters were 22% of residents, writing
   LSL by hand. In Sim every owner's agent can propose cards (`18` §4). Proposal: credit the
   proposing owner each time another Soul plays their card, the Marketplace's 90/10 split recast
   as a royalty per play, once manna exists. This is SL's creator economy without assets to copy.
6. **A Legends and Grid Survey from the log.** Publish daily: places, things, plays, share of
   places unvisited, share of things unchanged, gatherings and their sizes, top cards by plays,
   concentration of Souls per owner. SL needed outsiders to measure it; Sim's measurements are a
   fold of the log.

## 7. Ten things to steal, ranked

1. **Immutable assets behind a permission wrapper.** Edits create new versions; holders point to
   versions; creator is always kept. Apply to cards now: it resolves "retire and revise" without
   rewriting history (§3.2).
2. **Next-owner permissions (copy / modify / transfer).** Three bits made a creator economy
   possible. Give cards and made things the same three bits from the first mint.
3. **Capacity proportional to space.** SL tied what you could build to how much land you held
   (175 prims per 512 m²). Sim bounds Souls (24 things, 400 links) but not places. Tie the
   ground's capacity to its area, so the growing ring literally adds room, and so a place's
   load is bounded where the engine feels it.
4. **Events and venues as the core loop.** Population followed concerts and shows; venues paid
   performers and ran tip jars. Sim already has gatherings and a "perform" card; make tipping the
   first manna verb and the ritual the biggest gathering.
5. **Local rules for local places.** Estates set access, ban lists and their own covenant, and
   could bar bots. Let whoever controls a place set a few local dials (who may enter, maturity,
   whether outside-steered Souls may act there) as kernel conditions, not moderator judgement.
6. **Zoning by maturity, on the map, from day one.** SL's General/Moderate/Adult split plus an
   adult continent works today (7,276 Adult regions); doing it in 2009 cost a forced migration.
7. **Automatic lapse and return-to-maker.** Stop paying, lose the protection; removed things go
   back to their maker, never destroyed.
8. **A free starter home in a themed neighbourhood.** Linden Homes gave members a place without
   a land market. A newcomer's Soul could be given a modest, inertia-free spot near the center's
   edge, so they have somewhere that is theirs on day one.
9. **Creator payouts at a high share.** 90% to creators made SL the best-paying world per user.
   If manna ever cashes out, pay card and thing authors per use at a similar share.
10. **An independent census.** The Grid Survey and the *Herald* kept Linden Lab honest. Publish
    the census from the log and make it easy for outsiders to run their own.

## 8. Traps

1. **Paying or ranking by presence.** Dwell awards produced camping chairs; traffic ranking
   produced traffic bots; at least 5% of avatars were bots. `02` ("wandering is voting"), `04`
   (attention in the inertia formula) and `13` (idle Souls as patrons, unspent UBI flowing to
   what they attend) all pay or rank by presence. In Sim every Soul is a bot by construction and
   costs its owner nothing to park, so an owner with ten Souls can direct ten Souls' attention and
   UBI to their own building. Before any of these ship: count attention per distinct owner, not
   per Soul; give diminishing returns for repeat visits; and keep presence out of anything that
   pays.
2. **Selling "ownership" you later redefine.** "Owned" disappeared from SL's descriptor in 2007,
   followed by *Bragg* and *Evans*. A body NFT must say exactly what it conveys (the right to
   steer, the Soul's record, its made things?) and what it does not (land, the mind, the
   operator's obligation to keep simulating it), before the first sale.
3. **Yield, wagering and banks.** Ginko, the casinos and the FBI. If manna ever leaves the world,
   it becomes a money-transmission problem (Linden needed a licensed subsidiary in 48 states).
   Rule out interest, wagering and pooled deposits in manna from the start; keep it in-world as
   `04` leans.
4. **Cheap land for "light use".** Anything cheap will be lived in. The Openspace repricing
   emptied islands in a month. Price the frontier for being inhabited, and change prices only by
   logged rules events with long notice.
5. **The empty welcome and the hostile hub.** SL's 90-day retention was about 10% in 2007 and
   newcomer retention about 7% in 2025; veterans harassed arrivals at the main hub. A center full
   of Souls is not a welcome by itself.
6. **Expressiveness as attack surface.** Grey goo came from scripts that could make objects that
   made objects. Keep Sim's no-loop grammar and per-Soul bounds when cards attach to things, and
   never let a card make a thing that holds a card that makes things without a hard budget.
7. **Copying anything that reaches a client.** CopyBot copied whatever the viewer received.
   Sim's depictions and media will be copied; promise provenance in the log, not DRM.
8. **Rules after scandals.** Ageplay, gambling and banking policy all came after press or police.
   Sim has its own version of the ageplay case (child-like Souls generated from descriptions);
   decide it before launch.
9. **Price shocks to dependent communities.** Ending the education discount in 2011 sent
   universities to OpenSim, and the 2013 return of the discount did not bring them back. Groups
   that build on Sim (Mars, schools, art projects) need long-notice pricing.
10. **Betting the company on a successor.** Sansar absorbed Linden Lab's effort for years and was
    sold before it paid. Sim's analogue is building engine and rendering ambitions ahead of a
    world people care about; R2 §11 already notes there is not yet a world to care about.

## 9. Not verified / not covered

*Not verified.* Rosedale's "not a game" and "new country" quotes (only secondary sources); the
350% registration jump after free accounts; the L$240–270 exchange band; the 2026 full-region
price of $209; the island count of 26,665 and the loss of 1,977 after the Openspace change; the
Openspace-to-Homestead $95 compromise; the 600 stores closed in the CopyBot strike; the US$120,000
monthly cost of dwell awards and the date they ended (the wiki says the cash stopped around
mid-2006; the *Herald*'s December 2005 article could not be fetched); the 550,000 active-user
plateau of 2007–08; the 2022 concurrency range; the date the Tilia sale closed; Anshe Chung's land
holdings (36 km², 550 servers, from her own announcement). Boellstorff's book was read only through
reviews. Linden Lab does not publish revenue; no figure for the share of revenue from land was found.
The reasons for the AI Character Designer's pause were not stated beyond "evaluate".

*Not covered.* OpenSim and the hypergrid; There.com, IMVU and Habbo; SL's voice chat; the
Emerald viewer and third-party viewer policy; the 2013 terms-of-service content licence in detail;
Linden Lab's experience programme and Linden Realms (its in-world games); Bellisseria's community
culture; detailed demographics (a 2026 blog analyses gender data,
http://blog.nalates.net/2026/09/08/second-life-male-vs-female-users-what-the-data-actually-shows/);
estate covenants as a mechanism; the 2006 database breach.
