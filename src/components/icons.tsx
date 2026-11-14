import type { SVGProps } from 'react';

const base: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
};

export const PlayIcon = () => (
  <svg {...base}>
    <path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />
  </svg>
);
export const PauseIcon = () => (
  <svg {...base}>
    <rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
    <rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
  </svg>
);
export const PrevIcon = () => (
  <svg {...base}>
    <path d="M18 5v14L8 12z" fill="currentColor" stroke="none" />
    <path d="M6 5v14" />
  </svg>
);
export const NextIcon = () => (
  <svg {...base}>
    <path d="M6 5v14l10-7z" fill="currentColor" stroke="none" />
    <path d="M18 5v14" />
  </svg>
);
export const SpeakerIcon = () => (
  <svg {...base}>
    <path d="M4 9h4l5-4v14l-5-4H4z" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7" />
    <path d="M19 6a8.5 8.5 0 0 1 0 12" />
  </svg>
);
export const MuteIcon = () => (
  <svg {...base}>
    <path d="M4 9h4l5-4v14l-5-4H4z" />
    <path d="M17 9l5 6M22 9l-5 6" />
  </svg>
);
export const LoopIcon = () => (
  <svg {...base}>
    <path d="M4 11V9a3 3 0 0 1 3-3h12l-3-3" />
    <path d="M20 13v2a3 3 0 0 1-3 3H5l3 3" />
  </svg>
);
export const WaveIcon = () => (
  <svg {...base}>
    <path d="M2 12h2l2-6 3 12 3-14 3 16 3-10 2 2h2" />
  </svg>
);
export const StopIcon = () => (
  <svg {...base}>
    <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />
  </svg>
);

export const BrandMark = () => (
  <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <circle cx="16" cy="16" r="13" fill="none" stroke="#39DDF5" strokeWidth="1.5" />
    <path d="M5 16h4l2.5-5 3 10 3-13 3 11 2.5-6 1.5 3h3.5" fill="none" stroke="#F4FAFF" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);
