// Frozen representative cases: keep cameras and geometry identical between baseline and treatment.
export const genesis = {
 schema:'genesis/1',name:'Context view qualification',constants:{extent:160,ground:'land'},
 batches:[{note:'Five representative visual subjects',ops:[
  {op:'define',def:{schema:'def/1',name:'context-hall',version:1,description:'An enclosed lecture room.',tags:['building'],size:{box:[12,4,10]},make:{kind:'gen',gen:'building/1',args:{style:'shed',w:12,d:10,fh:4}},params:{w:{type:'number',default:12},d:{type:'number',default:10},floorHeight:{type:'number',default:4},floors:{type:'int',min:1,max:6,default:1}},state:{doors:{type:'json',default:{}}},components:{foundation:{kind:'none'}}}},
  {op:'place',def:'core/fountain@1',name:'landmark',p:[-24,0],about:{title:'Meeting fountain',what:'The outdoor meeting landmark.'}},
  {op:'place',tmp:'$hall',def:'context-hall@1',name:'hall',p:[0,0],about:{title:'Lecture hall',what:'An enclosed room for talks.'}},
  {op:'place',def:'core/bench@1',name:'podium',in:{parent:'$hall',slot:'ground'},p:[0,0,-2],about:{title:'Presenter seat',what:'The actual speaker seat inside the hall.'}},
  {op:'place',def:'core/picture-frame@1',name:'artwork',in:{parent:'$hall',slot:'ground'},p:[-3,1.7,-4.7],about:{title:'Wall artwork',what:'A small original image on the lecture hall wall.'}},
  {op:'place',def:'core/pond@1',name:'lake',shape:{area:[[20,-8],[36,-8],[36,8],[20,8]]},about:{title:'Quiet lake',what:'A small lake to the east.'}},
 ]}]
};
export const cases = [
 {id:'landmark',target:'landmark',eye:[-15,6,10],at:[-24,1,0]},
 {id:'enclosed-room',target:'hall',eye:[4,1.7,3.5],at:[-2,1.4,-2]},
 {id:'interior-seat',target:'hall/podium',eye:[2,1.7,1.5],at:[0,.65,-2]},
 {id:'lake',target:'lake',eye:[40,12,17],at:[28,0,0]},
 {id:'wall-artwork',target:'hall/artwork',eye:[-3,1.7,-1.5],at:[-3,1.7,-4.7]},
];
export const edits = [
 {id:'rename',ops:[{op:'set',id:'landmark',about:{title:'Assembly fountain',what:'The outdoor meeting landmark.'}}]},
 {id:'move',ops:[{op:'move',id:'landmark',p:[-23,1]}]},
 {id:'delete',ops:[{op:'remove',id:'landmark'}],then:'undo'},
 {id:'asset-replace',target:'hall/artwork',state:'media',assets:'two deterministic PNG versions uploaded to this fixture only'},
 {id:'intervening-wall',ops:[{op:'place',def:'core/wall@1',name:'occluder',p:[-21,4],r:-35,params:{w:10,h:5,d:.25}}]},
];
