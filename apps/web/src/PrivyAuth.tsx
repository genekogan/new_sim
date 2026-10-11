import {PrivyProvider,usePrivy} from '@privy-io/react-auth';
import {Shell,type AuthCtx} from './Shell.tsx';
type Cfg={privyAppId:string;publicUrl:string;worldId:string;authReady:boolean;devAuth:boolean;accountAuthRequired?:boolean};
function WithPrivy({ cfg,arrivalEnabled }: { cfg: Cfg;arrivalEnabled:boolean }) {
  const p = usePrivy();
  const email = p.user?.email?.address ?? p.user?.google?.email ?? null;
  const auth: AuthCtx = {
    ready: p.ready, authed: p.ready && p.authenticated, label: email ?? p.user?.id ?? null,
    login: () => p.login(), logout: () => p.logout(),
    getToken: async () => (p.ready && p.authenticated ? await p.getAccessToken() : null),
    debug: { privyUserId:p.user?.id??null,wallet:null,linked:[] },
  };
  return <Shell cfg={cfg} auth={auth} arrivalEnabled={arrivalEnabled} />;
}

export default function PrivyAuth({cfg,arrivalEnabled}:{cfg:Cfg;arrivalEnabled:boolean}){return <PrivyProvider appId={cfg.privyAppId} config={{loginMethods:['google','email'],embeddedWallets:{ethereum:{createOnLogin:'off'},showWalletUIs:false},appearance:{theme:'dark'}}}><WithPrivy cfg={cfg} arrivalEnabled={arrivalEnabled}/></PrivyProvider>;}
