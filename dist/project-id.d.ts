/**
 * Derives a stable project ID from a directory path.
 * Uses FNV-1a 32-bit hash — works in both Bun (server) and TUI (browser).
 * No crypto dependency required.
 */
export declare function deriveProjectId(directory: string): string;
