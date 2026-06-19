/**
 * Deprecated: discovery.ts is no longer used. The bus now listens on a fixed
 * port (4099) instead of a random port with file-based discovery.
 * This file is kept for reference but is not imported by current bus code.
 */
export declare function discoverPort(timeoutMs?: number): Promise<number>;
