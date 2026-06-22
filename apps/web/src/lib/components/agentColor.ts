/** Deterministic avatar color + initial for an agent/owner id — so the same delegate always reads
 * the same color across tiles, drawer, and telemetry (the "flight deck" instrument vocabulary). */
const PALETTE = ['#34D3B6', '#F4A526', '#FF6B57', '#b48bff', '#5b9cff', '#4cc2ff'];

export function agentColor(id: string | null | undefined): string {
  if (!id) return '#8B91A8'; // muted = unassigned
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function initialOf(name: string | null | undefined): string {
  return (name ?? '?').trim().charAt(0).toUpperCase() || '?';
}
