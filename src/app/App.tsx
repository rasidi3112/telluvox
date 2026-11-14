import { Suspense, useEffect, useRef } from 'react';
import { Footer } from '../components/Header/Footer';
import { Header } from '../components/Header/Header';
import { useHashRoute } from '../hooks/useHashRoute';
import { resolveRoute } from './routes';

export function App() {
  const path = useHashRoute();
  const route = resolveRoute(path);
  const Page = route.component;
  const mainRef = useRef<HTMLElement>(null);
  const first = useRef(true);

  useEffect(() => {
    document.title = route.title;
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    mainRef.current?.focus({ preventScroll: true });
  }, [route]);

  return (
    <>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); mainRef.current?.focus(); }}>
        Skip to content
      </a>
      <Header path={route.path} />
      <main id="main" ref={mainRef} tabIndex={-1} style={{ outline: 'none' }}>
        <Suspense fallback={<div className="container" role="status" style={{ padding: '48px 24px', color: 'var(--text-muted)' }}>Loading…</div>}>
          <Page />
        </Suspense>
      </main>
      <Footer />
    </>
  );
}
