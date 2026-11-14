import { useSyncExternalStore } from 'react';

function read(): string {
  const h = window.location.hash.replace(/^#/, '');
  return h.startsWith('/') ? h : '/';
}

/** Minimal hash router (no dependency): '#/jukebox' → '/jukebox'. */
export function useHashRoute(): string {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('hashchange', cb);
      return () => window.removeEventListener('hashchange', cb);
    },
    read,
    () => '/',
  );
}

export function navigate(path: string): void {
  window.location.hash = path;
}
