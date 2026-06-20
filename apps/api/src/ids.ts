/** Generate a prefixed id (`<prefix>_<hex>`), matching the contract's id shape (packages/contract/src/ids.ts). */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}
