export const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;
export const pad2 = (n: number) => String(n).padStart(2, '0');
export function hex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}
