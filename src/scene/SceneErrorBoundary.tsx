import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback: ReactNode;
}

/** Keeps the rest of the app usable if WebGL / the 3D scene fails. */
export class SceneErrorBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(error: unknown): void {
    console.warn('[TELLUVOX] 3D scene disabled:', error);
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function isWebGLAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
