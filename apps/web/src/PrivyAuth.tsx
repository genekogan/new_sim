// Privy sign-in is not built into this release (DEPS 2026-10-22: @privy-io/react-auth removed; live auth is Clerk).
// A server still configured with AUTH_PROVIDER=privy (the server default) and a PRIVY_APP_ID lands here: the world stays
// visitable signed out, and the sign-in button says plainly why it does nothing.
import {Shell} from './Shell.tsx';
type Cfg={privyAppId:string;publicUrl:string;worldId:string;authReady:boolean;devAuth:boolean;accountAuthRequired?:boolean};
const MESSAGE='Sign-in is not available: this server is configured for Privy, which is not built into this release. Use Clerk (AUTH_PROVIDER=clerk).';
export default function PrivyAuth({cfg,arrivalEnabled}:{cfg:Cfg;arrivalEnabled:boolean}){
  return <Shell cfg={cfg} auth={{ready:true,authed:false,label:null,login:()=>alert(MESSAGE),logout:()=>{},getToken:async()=>null,debug:{privyUserId:null,wallet:null,linked:[]}}} arrivalEnabled={arrivalEnabled}/>;
}
