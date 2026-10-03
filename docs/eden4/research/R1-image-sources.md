# R1 image sources (for R1-ontology-prior-art.html)

Status: final, 2026-10-02. Images are referenced by URL only; nothing was downloaded to disk.

"Verified" means a GET (curl -sL, following redirects) returned HTTP 200 with an image
content-type on 2026-10-02. Every URL in the first table was re-checked in one final pass
after the page was finished. Wikimedia was checked with a descriptive User-Agent and spaced
requests (it rate-limits). The AI Town asset needs a browser `Accept: image/*` header: GitHub
redirects to a signed S3 URL that returns 403 to HEAD but 200 to GET.

## On the page (17 images, all verified)

| § | System | Image URL | Source page | Credit | What it shows (content viewed?) |
|---|---|---|---|---|---|
| 1 | STRIPS | https://upload.wikimedia.org/wikipedia/commons/0/0c/SRI_Shakey_with_callouts.jpg | https://commons.wikimedia.org/wiki/File:SRI_Shakey_with_callouts.jpg | SRI International, CC BY-SA 3.0 | Shakey, the robot STRIPS planned for (not viewed in this pass) |
| 1 | GOAP | https://upload.wikimedia.org/wikipedia/en/1/18/F.E.A.R._gameplay_1.jpg | https://en.wikipedia.org/wiki/File:F.E.A.R._gameplay_1.jpg | © Monolith; fair-use low-res | F.E.A.R. gameplay (not viewed) |
| 2 | The Sims | https://upload.wikimedia.org/wikipedia/en/9/91/SimsSS.jpg | https://en.wikipedia.org/wiki/File:SimsSS.jpg | © Electronic Arts; fair-use low-res | a household lot from above (viewed on the page) |
| 3 | Dwarf Fortress | https://bay12games.com/dwarves/imgs/classic_01.png | https://www.bay12games.com/dwarves/ | © Bay 12 Games | classic display: fortress map + a craftsdwarf's Memories tab (viewed) |
| 4 | Façade | https://web.archive.org/web/20060114000455im_/http://www.interactivestory.net:80/facadeimages/facade_1playergreets.jpg | https://web.archive.org/web/20061231043053/http://www.interactivestory.net/ | © Procedural Arts; official press screenshot | Trip at the door, player types "hi Trip! how are you!" (viewed). The live interactivestory.net domain is no longer the project's; link only the archive |
| 5 | Prom Week | https://promweek.soe.ucsc.edu/files/2012/10/newInterface.jpg | https://promweek.soe.ucsc.edu/ | Expressive Intelligence Studio, UC Santa Cruz | choosing an exchange toward Doug (Show Off, Insult, Bully, Woo) (viewed) |
| 5 | Ensemble | https://raw.githubusercontent.com/ensemble-engine/ensemble/master/docs/toolscreenshot.png | https://github.com/ensemble-engine/ensemble | Ensemble Engine project | Rules Editor: volition rule "Everyone wants to increase closeness" (viewed) |
| 6 | Versu | https://versu.com/wp-content/uploads/2014/05/linus_bergstrom_amused.png | https://versu.com/ | © Versu | a character portrait (expression "amused") (viewed). NOT gameplay; the page says no in-app screenshot was found |
| 8 | FIPA | https://web.archive.org/web/20250813135423im_/http://www.fipa.org/specs/fipa00026/SC00026H_files/image001.gif | https://web.archive.org/web/20250813135423/http://www.fipa.org/specs/fipa00026/SC00026H.html | FIPA, spec SC00026H | Request Interaction Protocol sequence diagram (viewed). fipa.org itself returns 403 to curl |
| 9 | Inform 7 | https://upload.wikimedia.org/wikipedia/commons/1/1a/Inform_7_code_and_skein.png | https://commons.wikimedia.org/wiki/File:Inform_7_code_and_skein.png | Alan De Smet; GPL | IDE: source beside the skein (not viewed) |
| 10 | ECS | https://upload.wikimedia.org/wikipedia/commons/2/23/ECS_Simple_Layout.svg | https://commons.wikimedia.org/wiki/File:ECS_Simple_Layout.svg | Guypeter4, CC0 | entity/component table diagram (SVG source read) |
| 11 | Generative Agents | https://arxiv.org/html/2304.03442v2/figures/figure_architecture2.png | https://arxiv.org/abs/2304.03442 | Park et al., 2023 | Fig. 5, architecture (not viewed; file name and figure number from arXiv HTML) |
| 11 | Generative Agents | https://arxiv.org/html/2304.03442v2/figures/figure_valentine3.png | https://arxiv.org/abs/2304.03442 | Park et al., 2023 | Fig. 4, Valentine's Day party (not viewed) |
| 11 | AI Town | https://github.com/a16z-infra/ai-town/assets/3489963/a4c91f17-23ed-47ec-8c4e-9f9a8505057d | https://github.com/a16z-infra/ai-town | a16z-infra / Convex | README screenshot: town map + conversation log (viewed). About 2 MB |
| 12 | Voyager | https://arxiv.org/html/2305.16291v2/skill_library_fig.png | https://arxiv.org/abs/2305.16291 | Wang et al., 2023 | Fig. 4, skill library (not viewed) |
| 12 | Project Sid | https://arxiv.org/html/2411.00114v1/architecture.png | https://arxiv.org/abs/2411.00114 | Altera.AL, 2024 | Fig. 3, PIANO architecture (not viewed) |
| 14 | Infinite Craft | https://upload.wikimedia.org/wikipedia/en/a/aa/Gameplay_screenshot_of_Infinite_Craft%2C_2024.png | https://en.wikipedia.org/wiki/File:Gameplay_screenshot_of_Infinite_Craft,_2024.png | © Neal Agarwal; fair-use low-res | canvas of elements (two "First Discovery") + sidebar (viewed) |

## No real image on the page (stated on the page)

- §7 Talk of the Town / Kismet: no linkable figure or screenshot; Kismet's 2020 paper not located.
- §13 Concordia: README has only badges; no arXiv HTML figures for 2312.03664 or 2507.08892; the DeepMind publication page has none.
- Versu: only a portrait; no in-app screenshot (versu.com shows splash art and portraits; Emily Short's blog tag page had none).

## Verified, not used

| System | URL | Note |
|---|---|---|
| Façade | https://web.archive.org/web/20060116151055im_/http://www.interactivestory.net:80/facadeimages/facade_4arguing.jpg | Trip and Grace side by side (viewed) |
| Façade | https://upload.wikimedia.org/wikipedia/en/9/9c/Facade_screenshot_Trip_%26_Grace.jpg | Wikipedia fair-use copy (replaced by the official screenshot) |
| FIPA | https://web.archive.org/web/20250813135423im_/http://www.fipa.org/specs/fipa00026/SC00026H_files/image002.gif | second figure of the spec |
| Versu | https://versu.com/wp-content/uploads/2014/05/versu_splash.jpg | splash art: iPad with logo and press quotes (viewed; not gameplay) |
| Versu | https://versu.com/wp-content/uploads/2014/05/patrick_rutigliano_pleased_with_self.png | portrait |
| Dwarf Fortress | https://bay12games.com/dwarves/imgs/dwarf_sheet.png | Steam-era UI with a unit panel |
| Dwarf Fortress | https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/975370/72780d67585fda02ff95373c9cfc0a7b35193341/ss_72780d67585fda02ff95373c9cfc0a7b35193341.1920x1080.jpg (and three more ss_ files in the same app folder) | Steam store screenshots; not viewed |
| Datomic | https://docs.datomic.com/images/topology-abstract.png | system topology, not the data model |
| Prom Week | https://promweek.soe.ucsc.edu/files/2012/05/procedurallyGeneratedTranscript.png ; https://promweek.soe.ucsc.edu/files/2012/01/neatAlright1.png | not viewed |
| Project Sid | https://arxiv.org/html/2411.00114v1/constitution.png | Fig. 10 |
| Voyager | https://arxiv.org/html/2305.16291v2/pull_fig_fig.png ; https://voyager.minedojo.org/assets/images/skill_library.png ; https://voyager.minedojo.org/assets/images/components.png | alternates |
| Generative Agents | https://arxiv.org/html/2304.03442v2/figures/figure_cover4.png (5.3 MB) | too heavy |
