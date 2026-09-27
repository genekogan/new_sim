import { Component, lazy, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './globals.css';
const Studio = lazy(() => import('./studio/page'));
const Reconstruction = lazy(() => import('./page'));
const Guide = lazy(() => import('./simulation-guide/page'));
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
const route = location.pathname.replace(/\/$/, '') || '/';
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <Suspense
      fallback={
        <p role="status" style={{ padding: 32 }}>
          Loading Mars…
        </p>
      }
    >
      {route === '/studio' || /^\/studio\/202[0-6]$/.test(route) ? (
        <Studio year={route === '/studio' ? 2026 : Number(route.split('/')[2])} />
      ) : route === '/simulation-guide' ? (
        <Guide />
      ) : route === '/' ? (
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
