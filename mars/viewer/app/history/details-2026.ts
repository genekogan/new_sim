import * as T from 'three';
import {add2026FacadeDetails} from './details-2026-facade';
import {add2026RoofStructure,add2026WestCanopyContact,correct2026RackFinish,correct2026WestStairOpening} from './details-2026-structure';
import {add2026ChibaInteriors} from './details-2026-chiba';
import {add2026CompoundDetails} from './details-2026-compound';
import {add2026ToolLibrary} from './details-2026-tool-library';
import {add2026OGVehicles} from './details-2026-og-vehicles';
import {correct2026MimosTopology} from './details-2026-mimos-topology';
import {add2026MimosHome} from './details-2026-mimos-home';
import {add2026GroundLife} from './details-2026-ground-life';
import {add2026GalleryLife} from './details-2026-gallery';
import {add2026AuditoriumDetails} from './details-2026-auditorium';
/** Source-reviewed 2026 corrections applied consistently after the retained CAD loads.
 * Original components keep their IDs; detailed provenance lives in each module.
 */
export function add2026Details(root:T.Group){
 correct2026RackFinish(root);
 correct2026WestStairOpening(root);
 add2026FacadeDetails(root);
 const canopy=add2026WestCanopyContact(root);
 const roof=add2026RoofStructure(root);
 const chiba=add2026ChibaInteriors(root);
 const mimosHome=add2026MimosHome(root);
 const mimosTopology=correct2026MimosTopology(root);
 const auditorium=add2026AuditoriumDetails(root);
 const gallery=add2026GalleryLife(root);
 const compound=add2026CompoundDetails(root);
 const toolLibrary=add2026ToolLibrary(root);
 const og=add2026OGVehicles(root);
 const groundLife=add2026GroundLife(root);
 root.updateMatrixWorld(true);
 return [groundLife,gallery,canopy,roof,mimosHome,mimosTopology,toolLibrary,...(auditorium||[]),...(chiba||[]),...(compound||[]),...(og||[])].filter(Boolean);
}
