// The launcher homepage (`<base>/`, new worlds): its own lazy chunk with its Clerk, so a world page never downloads
// either (P1 phones: main.tsx loads it only on the homepage).
import { ClerkProvider, useAuth, useClerk, useUser } from '@clerk/clerk-react';
import { useEffect } from 'react';
import { clerkHomeRoute } from './auth-ui.ts';
import { BASE } from './base-path.ts';
import { publishSession, type Session } from './auth-session.ts';
import { LauncherHome, type LauncherList } from './god-ui/LauncherHome.tsx';

/** Clerk when the launcher serves Clerk worlds (creating a world needs a signed-in creator), else the local name. */
export default function LauncherRoot({ list }: { list: LauncherList }) {
  const a = list.auth;
  if (a?.provider === 'clerk' && a.clerkPublishableKey) {
    const route = clerkHomeRoute(a.authenticationOrigin, location.origin, BASE);
    if (route.initialize) return <ClerkProvider publishableKey={a.clerkPublishableKey}><HomeClerk list={list} /></ClerkProvider>;
    return <HomeWith list={list} session={{ mode: 'clerk', ready: true, authed: false, label: null, signInUrl: route.signInUrl ?? undefined, getToken: async () => null, login: () => { if (route.signInUrl) location.assign(route.signInUrl); }, logout: () => {} }} />;
  }
  const name = localStorage.getItem('sim.dev');
  return <HomeWith list={list} session={{ mode: 'dev', ready: true, authed: !!name, label: name, getToken: async () => name ? 'dev:' + name : null, login: () => {}, logout: () => { localStorage.removeItem('sim.dev'); location.reload(); } }} />;
}
function HomeWith({ list, session }: { list: LauncherList; session: Session }) {
  useEffect(() => { publishSession(session); });
  return <LauncherHome initial={list} />;
}
function HomeClerk({ list }: { list: LauncherList }) {
  const session = useAuth(), clerk = useClerk(), profile = useUser();
  return <HomeWith list={list} session={{ mode: 'clerk', ready: session.isLoaded, authed: session.isLoaded && !!session.isSignedIn, label: profile.user?.primaryEmailAddress?.emailAddress ?? profile.user?.firstName ?? null,
    getToken: async () => session.isLoaded && session.isSignedIn ? session.getToken({ skipCache: true }) : null,
    login: () => clerk.openSignIn({ afterSignInUrl: location.href, afterSignUpUrl: location.href }), logout: () => clerk.signOut() }} />;
}
