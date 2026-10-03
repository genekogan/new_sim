import { Component, lazy, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './globals.css';
const Studio = lazy(() => import('./studio/page'));
const Reconstruction = lazy(() => import('./page'));
const Guide = lazy(() => import('./simulation-guide/page'));
const Lab = lazy(() => import('./lab/page'));
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main style={{ padding: 32 }}>
        <h1>The viewer could not start</h1>
        <p>
          Reload to retry. If the problem persists, check that WebGL is enabled.
        </p>
        <button onClick={() => location.reload()}>Reload viewer</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
const requestedRoute = location.pathname.replace(/\/$/, '') || '/';
const route = requestedRoute === '/l/mars' ? '/lab' : requestedRoute.replace(/^\/w\/mars\/(202[0-7])$/, '/studio/$1');
const requestedYear = new URLSearchParams(location.search).get('year');
const presentationYear =
  requestedYear && /^202[0-7]$/.test(requestedYear)
    ? Number(requestedYear)
    : 2026;
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <Suspense
      fallback={
        <p role="status" style={{ padding: 32 }}>
          Loading Mars…
        </p>
      }
    >
      {route === '/studio' || /^\/studio\/202[0-7]$/.test(route) ? (
        <Studio
          year={route === '/studio' ? 2026 : Number(route.split('/')[2])}
        />
      ) : route === '/lab' ? (
        <Lab />
      ) : route === '/simulation-guide' ? (
        <Guide />
      ) : route === '/' ? (
        <Studio year={presentationYear} presentation />
      ) : route === '/photo' ? (
        <Reconstruction />
      ) : (
        <main style={{ padding: 32 }}>
          <h1>Page not found</h1>
          <a href="/studio">Open campus studio</a>
        </main>
      )}
    </Suspense>
  </ErrorBoundary>,
);
