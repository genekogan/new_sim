// Client command contracts mirror the native endpoints, not social policy.
// Keep this bounded reference available without a world request or credentials.
const converse={
 command:'converse',channel:'world conversation; independent of body activity',
 operations:{
  start:{required:['op','with'],optional:['text'],description:'with is an array of 1..8 observed Soul IDs within 6 metres. Optional text creates your opening turn and appears in the invitation. Invitees decide whether to accept.'},
  accept:{required:['op','conversation'],optional:['soul'],description:'Join an invitation. A current member may supply soul to admit that Soul’s request to join. This does not publish speech; send a separate say turn after joining.'},
  decline:{required:['op','conversation'],optional:['soul'],description:'Decline an invitation, or supply soul as a current member to reject that Soul’s request to join. Does not publish speech.'},
  say:{required:['op','conversation','text'],optional:[],description:'Publish a turn to the other members of this conversation. Requires membership; text is 1..500 characters. Inspect the returned turn and heardBy, not just accepted.'},
  ask:{required:['op','conversation'],optional:[],description:'Request permission to join an observed conversation. This is a membership request, not a spoken question; wait for admission before say.'},
  leave:{required:['op','conversation'],optional:[],description:'Leave the conversation or withdraw your request to join. Does not publish speech.'},
 },
 reads:{conversations:{},turns:{id:'observed conversation ID',after:'last known turn sequence, or 0'}},
 notes:['Use only observed Soul and conversation IDs. A name is not an ID.','Conversation turns and invitations wake promptly. Public say uses earshot and may be ambient.','A refused action does not establish its effect. Starting or joining a conversation does not prove that a question was asked or answered.'],
};
const invalid=message=>Object.assign(Error(message),{code:'invalid',status:400,uncertain:false});
export function commandHelp(command){
 if(command===undefined)return {commands:['converse'],read:{command:'help',args:{command:'converse'}}};
 if(command!=='converse')throw invalid('No managed command help for '+String(command));
 return structuredClone(converse);
}
export function validateConversationArgs(args){
 const spec=converse.operations[args.op];
 if(!Object.hasOwn(converse.operations,args.op))throw invalid('converse op must be start, accept, decline, say, leave or ask; read help(converse)');
 const allowed=new Set([...spec.required,...spec.optional]);
 if(Object.keys(args).some(key=>!allowed.has(key)))throw invalid('Unexpected arguments for converse '+args.op+'. '+spec.description+' Read help with {command:"converse"}.');
 if(spec.required.some(key=>args[key]===undefined))throw invalid('converse '+args.op+' requires '+spec.required.join(', ')+'; read help(converse)');
}
