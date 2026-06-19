import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { PortInfo } from "./types.js";

const PORT_FILE = join(homedir(), ".cache", "opencode", "plugin-bus", "port.json");

/**
 * Deprecated: discovery.ts is no longer used. The bus now listens on a fixed
 * port (4099) instead of a random port with file-based discovery.
 * This file is kept for reference but is not imported by current bus code.
 */

export async function discoverPort(timeoutMs = 3000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const data = await readFile(PORT_FILE, "utf-8");
      const info: PortInfo = JSON.parse(data);
      if (info.port && info.port > 0 && info.port <= 65535) {
        return info.port;
      }
      throw new Error(`Invalid port in discovery file: ${info.port}`);
    } catch (err) {
      lastError = err;
      await sleep(100);
    }
  }
  throw new Error(`Plugin bus not available after ${timeoutMs}ms: ${lastError}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
