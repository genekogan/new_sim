// Local component fixture for clipboard-denial input paths; no credentials or network writes.
import {createRoot} from 'react-dom/client';
import {Markdown} from '../src/god-ui/markdown.tsx';
import {AgentConnection} from '../src/AgentConnection.tsx';
import '../src/styles.css';
import '../src/world-chrome.css';
import '../src/god-ui/god-panel.css';
createRoot(document.getElementById('root')!).render(<div className="human-world"><main style={{padding:24,maxWidth:600,margin:'auto'}}>
 <h1>Clipboard regression fixture</h1><Markdown source={'```paste-to-your-agent\nRead https://sim.eden.art/w/eden/SKILL.md and follow its God mode section\n```'}/>
 <AgentConnection api={async()=>({status:403,data:{}})} soulId="s_fixture" name="Fixture Soul" base="https://sim.eden.art/w/eden" connection={{attached:false,label:null,since:null,last_used:null}} refresh={()=>{}}/>
</main></div>);
