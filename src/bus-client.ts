import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { discoverPort } from "./discovery.js";
import { memoryBus } from "./memory-bus.js";
import type { BusEnvelope, BusHealth } from "./types.js";

const BASE_URL = "http://127.0.0.1";

// Spawn lock — prevents concurrent connect() calls from spawning duplicate
// bus processes while a start is already in flight. Released on settle.
let spawnLock: Promise<number> | null = null;

/**
 * Server-side client for the plugin bus.
 * Plugins import BusClient, publish messages via HTTP POST.
 *
 * Falls back to an in-memory EventBus when the Go binary is not available.
 *
 * Usage:
 *   const bus = await BusClient.connect();
 *   await bus.publish("tbg/status", { cumulative: 1234 });
 */
export class BusClient {
  protected port: number;
  private baseUrl: string;

  protected constructor(port: number) {
    this.port = port;
    this.baseUrl = `${BASE_URL}:${port}`;
  }

  /**
   * Connect to the plugin bus. Auto-starts the bus binary if not running.
   * Falls back to in-memory EventBus if no binary is available.
   * @param opts.timeoutMs — Max time to wait for bus to start (default 5000ms)
   * @param opts.onWarn — Optional callback for warning messages (default console.warn)
   */
  static async connect(
    opts?: { timeoutMs?: number; onWarn?: (message: string, ...args: unknown[]) => void },
  ): Promise<BusClient> {
    const timeoutMs = opts?.timeoutMs ?? 5000;
    const warn = opts?.onWarn ?? console.warn;

    // 1. Check if bus is already running
    try {
      const port = await discoverPort(500); // quick check — 500ms
      const healthy = await BusClient.checkHealth(port);
      if (healthy) {
        return new BusClient(port);
      }
    } catch {
      // Bus not running — will auto-start below
    }

    // 2. Auto-start the bus binary
    try {
      const port = await BusClient.startBus(timeoutMs, warn);
      return new BusClient(port);
    } catch (err) {
      // 3. Fallback to in-memory bus (no binary available)
      warn(
        "[BusClient] Go bus not available, using in-memory fallback:",
        (err as Error).message,
      );
      return new MemoryBusClient();
    }
  }

  /**
   * Resolve the bus binary path.
   * Prefers ~/.local/bin/bus over bare "bus" (which relies on PATH).
   */
  private static findBusBinary(): string {
    return join(homedir(), ".local", "bin", "four-local-bus"); // ~/.local/bin/four-local-bus
  }

  /**
   * Spawn the bus binary and read the port from stdout.
   * Guarded by a module-level spawn lock so concurrent connect() calls share
   * the same in-flight spawn instead of forking multiple bus processes.
   */
  private static async startBus(
    timeoutMs: number,
    warn: (message: string, ...args: unknown[]) => void,
  ): Promise<number> {
    if (spawnLock) return spawnLock;
    spawnLock = BusClient.spawnBus(timeoutMs, warn).finally(() => {
      spawnLock = null;
    });
    return spawnLock;
  }

  /**
   * Inner spawn implementation — wraps the child process in a Promise.
   * Kept separate from startBus() so the spawn lock can be released cleanly.
   */
  private static spawnBus(
    timeoutMs: number,
    warn: (message: string, ...args: unknown[]) => void,
  ): Promise<number> {
    const binary = BusClient.findBusBinary();
    return new Promise((resolve, reject) => {
      const child = spawn(binary, [], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Bus (${binary}) failed to start within ${timeoutMs}ms`));
      }, timeoutMs);

      let resolved = false;

      child.stdout?.on("data", (data: Buffer) => {
        if (resolved) return;
        try {
          const line = data.toString().trim();
          const info = JSON.parse(line);
          if (info.port && info.port > 0) {
            resolved = true;
            clearTimeout(timer);
            // Note: child process stays alive (bus server runs)
            resolve(info.port);
          }
        } catch {
          // Not JSON — wait for next line
        }
      });

      child.stderr?.on("data", (data: Buffer) => {
        // Log stderr but don't fail — Go may print warnings
        warn("[BusClient] bus stderr:", data.toString().trim());
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`Failed to spawn bus: ${err.message}`));
      });

      child.on("exit", (code) => {
        if (!resolved) {
          clearTimeout(timer);
          reject(
            new Error(`Bus exited with code ${code} before reporting port`),
          );
        }
      });
    });
  }

  /**
   * Check if bus at given port is healthy.
   */
  private static async checkHealth(port: number): Promise<boolean> {
    try {
      const response = await fetch(`${BASE_URL}:${port}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) return false;
      const health: BusHealth = await response.json();
      return health.status === "ok";
    } catch {
      return false;
    }
  }

  /**
   * Publish a message to a channel.
   * @param channel — Channel name (e.g., "tbg/ses_abc/status")
   * @param payload — Message payload (any JSON-serializable value)
   */
  async publish(channel: string, payload: unknown): Promise<void> {
    const envelope: BusEnvelope = {
      channel,
      payload,
      ts: Date.now(),
    };

    const response = await fetch(`${this.baseUrl}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Publish failed (${response.status}): ${body}`);
    }
  }

  /**
   * Check if the bus is healthy.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) return false;
      const health: BusHealth = await response.json();
      return health.status === "ok";
    } catch {
      return false;
    }
  }

  /** The port the bus is running on (0 = in-memory mode) */
  get activePort(): number {
    return this.port;
  }

  /**
   * Close the client. No-op for plain HTTP clients — each call already uses
   * a fresh request. Defined here so ScopedBusClient can override it as a
   * no-op without accidentally inheriting a future lifecycle teardown.
   */
  close(): void {
    // No-op at base level. HTTP requests are stateless.
  }

  /** Returns a scoped client that prefixes all channels with {service}/ */
  forService(name: string): BusClient {
    return new ScopedBusClient(this, `${name}/`);
  }

  /** Returns a scoped client that prefixes all channels with {sessionId}/ */
  forSession(id: string): BusClient {
    return new ScopedBusClient(this, `${id}/`);
  }
}

/**
 * Scoped view of a BusClient — prepends a channel prefix to publish().
 * forService/forSession compose: nested calls stack prefixes.
 *
 * Extends BusClient so the public `forService`/`forSession` return type is
 * `BusClient` (callers don't need to know about the scoped wrapper).
 */
class ScopedBusClient extends BusClient {
  constructor(private readonly inner: BusClient, private readonly prefix: string) {
    super(inner.activePort); // satisfies protected constructor; port unused
  }

  override async publish(channel: string, payload: unknown): Promise<void> {
    return this.inner.publish(this.prefix + channel, payload);
  }

  override async healthCheck(): Promise<boolean> {
    return this.inner.healthCheck();
  }

  override close(): void {
    // Scoped views do not own the underlying bus lifecycle
  }

  override get activePort(): number {
    return this.inner.activePort;
  }

  override forService(name: string): BusClient {
    return new ScopedBusClient(this.inner, this.prefix + name + "/");
  }

  override forSession(id: string): BusClient {
    return new ScopedBusClient(this.inner, this.prefix + id + "/");
  }
}

/**
 * In-memory fallback client. Implements same API as BusClient.
 * Uses shared MemoryBus singleton — works within same process only.
 * Port is 0 (sentinel value for in-memory mode).
 */
class MemoryBusClient extends BusClient {
  constructor() {
    super(0); // port 0 = in-memory mode
  }

  override async publish(channel: string, payload: unknown): Promise<void> {
    memoryBus.publish(channel, payload);
  }

  override async healthCheck(): Promise<boolean> {
    return true; // memory bus is always healthy
  }

  override get activePort(): number {
    return 0; // indicates in-memory mode
  }
}
