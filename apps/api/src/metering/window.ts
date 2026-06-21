/** Parse a rolling-window spec ("30m" | "5h" | "7d") into milliseconds (docs/07 §6), or null. */
export function parseWindowMs(window: string): number | null {
  const match = /^(\d+)([mhd])$/.exec(window);
  if (!match) return null;
  const n = Number(match[1]);
  if (n <= 0) return null;
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 'm' | 'h' | 'd'];
  return n * unit;
}
