/**
 * Derives a stable project ID from a directory path.
 * Uses FNV-1a 32-bit hash — works in both Bun (server) and TUI (browser).
 * No crypto dependency required.
 */
export function deriveProjectId(directory: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < directory.length; i++) {
    h ^= directory.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
