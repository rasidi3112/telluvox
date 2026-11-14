import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { LandingPage } from './pages/LandingPage';

export interface RouteDef {
  path: string;
  navLabel: string;
  /** Shorter label for narrow screens. */
  shortLabel: string;
  title: string;
  component: ComponentType | LazyExoticComponent<ComponentType>;
}

// The jukebox and its 3D/audio code are split into their own chunk.
const JukeboxPage = lazy(() => import('./pages/JukeboxPage'));
const UnderstandingPage = lazy(() => import('./pages/UnderstandingPage'));

export const ROUTES: RouteDef[] = [
  { path: '/', navLabel: 'Home', shortLabel: 'Home', title: 'TELLUVOX | Hear What Earth Reveals', component: LandingPage },
  { path: '/jukebox', navLabel: 'Earth Jukebox', shortLabel: 'Jukebox', title: 'Earth Jukebox | TELLUVOX', component: JukeboxPage },
  { path: '/understanding', navLabel: 'Understanding the Sound', shortLabel: 'How it works', title: 'Understanding the Sound | TELLUVOX', component: UnderstandingPage },
];

export function resolveRoute(path: string): RouteDef {
  return ROUTES.find((r) => r.path === path) ?? (ROUTES[0] as RouteDef);
}
