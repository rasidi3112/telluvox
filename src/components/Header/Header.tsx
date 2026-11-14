import { BrandMark } from '../icons';
import { ROUTES } from '../../app/routes';

export function Header({ path }: { path: string }) {
  return (
    <header className="site-header">
      <div className="container">
        <a className="brand" href="#/" aria-label="TELLUVOX home">
          <BrandMark />
          <span className="brand-name">TELLUVOX</span>
        </a>
        <nav className="site-nav" aria-label="Main">
          {ROUTES.map((r) => (
            <a key={r.path} href={`#${r.path}`} aria-current={path === r.path ? 'page' : undefined} aria-label={r.navLabel}>
              <span className="nav-long">{r.navLabel}</span>
              <span className="nav-short" aria-hidden="true">
                {r.shortLabel}
              </span>
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
