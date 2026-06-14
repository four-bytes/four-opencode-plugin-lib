import { discoverPort } from "./discovery.js";
import { memoryBus } from "./memory-bus.js";
import type { BusEnvelope, BusCallback, Unsubscribe } from "./types.js";

const WS_BASE = "ws://127.0.0.1";

interface SubEntry {
  pattern: string;
  callback: BusCallback;
}

/**
 * TUI-side client for the plugin bus. Connects via WebSocket, subscribes to
 * channels, receives real-time messages. Throws on `connect()` if the Go bus
 * is not available — use `new MemoryBusTui()` explicitly for in-process mode.
 *
 * Usage:
 *   const bus = await BusTui.connect();
 *   const unsub = bus.subscribe("tbg/+/status", (msg) => {
 *     console.log(msg.channel, msg.payload);
 *   });
 *   // Later: unsub(); or bus.close();
 */
export class BusTui {
  protected port: number;
  private ws: WebSocket | null = null;
  private subs: SubEntry[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private closed = false;

  protected constructor(port: number) {
    this.port = port;
  }

  /**
   * Connect to the plugin bus via WebSocket. Throws if the Go bus is not available.
   */
  static async connect(timeoutMs = 5000): Promise<BusTui> {
    const port = await discoverPort(timeoutMs);
    const bus = new BusTui(port);
    try {
      await bus.open();
    } catch (err) {
      throw new Error(
        `[BusTui] failed to connect to Go bus on port ${port}: ${(err as Error).message}`,
      );
    }
    return bus;
  }

  /**
   * Subscribe to a channel pattern. Callback fires on each matching message.
   * Returns an unsubscribe function.
   *
   * @param pattern — Channel pattern (e.g., "tbg/+/status", "brain/embed")
   * @param callback — Called with each message matching the pattern
   */
  subscribe(pattern: string, callback: BusCallback): Unsubscribe {
    const entry: SubEntry = { pattern, callback };
    this.subs.push(entry);

    // Update WebSocket subscription if connected
    this.updateSubscriptions();

    return () => {
      this.subs = this.subs.filter((s) => s !== entry);
      this.updateSubscriptions();
    };
  }

  /**
   * Publish a message back to the bus (bidirectional).
   */
  publish(channel: string, payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[BusTui] Cannot publish — not connected");
      return;
    }
    const envelope: BusEnvelope = {
      channel,
      payload,
      ts: Date.now(),
    };
    this.ws.send(JSON.stringify(envelope));
  }

  /**
   * Close the WebSocket connection and stop reconnecting.
   */
  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subs = [];
  }

  /** Returns a scoped TUI bus that prefixes all channels with {service}/ */
  forService(name: string): BusTui {
    return new ScopedBusTui(this, `${name}/`);
  }

  /** Returns a scoped TUI bus that prefixes all channels with {sessionId}/ */
  forSession(id: string): BusTui {
    return new ScopedBusTui(this, `${id}/`);
  }

  // ── Private ────────────────────────────────────────────

  private async open(): Promise<void> {
    if (this.closed) return;

    const url = `${WS_BASE}:${this.port}/subscribe`;
    this.ws = new WebSocket(url);

    return new Promise((resolve, reject) => {
      if (!this.ws) return reject(new Error("Failed to create WebSocket"));

      this.ws.onopen = () => {
        this.reconnectDelay = 1000; // reset backoff
        this.updateSubscriptions();
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg: BusEnvelope = JSON.parse(event.data as string);
          for (const sub of this.subs) {
            if (matchPattern(sub.pattern, msg.channel)) {
              sub.callback(msg);
            }
          }
        } catch {
          // ignore malformed messages
        }
      };

      this.ws.onclose = () => {
        this.ws = null;
        if (!this.closed) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        // onclose will fire after this
        reject(new Error(`WebSocket connection failed to port ${this.port}`));
      };
    });
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    this.reconnectTimer = setTimeout(async () => {
      // Re-read the port file — the bus may have restarted on a new port
      // (e.g. after a crash) and the cached port would now be dead.
      this.port = 0;
      try {
        const port = await discoverPort(2000);
        if (port > 0) this.port = port;
      } catch {
        // discoverPort failed — keep port=0, open() will report and retry
      }
      try {
        await this.open();
      } catch {
        // will retry via onclose → scheduleReconnect loop
      }
      this.reconnectDelay = Math.min(
        this.reconnectDelay * 2,
        this.maxReconnectDelay,
      );
    }, this.reconnectDelay);
  }

  private updateSubscriptions(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const patterns = this.subs.map((s) => s.pattern).join(",");
    if (patterns) {
      this.ws.send(JSON.stringify({ subscribe: patterns }));
    }
  }
}

/**
 * Scoped view of a BusTui — prepends a channel prefix to subscribe/publish.
 * forService/forSession compose: nested calls stack prefixes.
 *
 * Extends BusTui so the public `forService`/`forSession` return type is
 * `BusTui` (callers don't need to know about the scoped wrapper).
 */
class ScopedBusTui extends BusTui {
  constructor(private readonly inner: BusTui, private readonly prefix: string) {
    super(0); // satisfies protected constructor; port unused (delegated via inner)
  }

  override subscribe(pattern: string, callback: BusCallback): Unsubscribe {
    return this.inner.subscribe(this.prefix + pattern, callback);
  }

  override publish(channel: string, payload: unknown): void {
    this.inner.publish(this.prefix + channel, payload);
  }

  override close(): void {
    // Scoped views do not own the underlying bus lifecycle
  }

  override forService(name: string): BusTui {
    return new ScopedBusTui(this.inner, this.prefix + name + "/");
  }

  override forSession(id: string): BusTui {
    return new ScopedBusTui(this.inner, this.prefix + id + "/");
  }
}

/**
 * In-memory TUI client. Implements same API as BusTui.
 * Uses shared MemoryBus singleton — works within same process only.
 * Port is 0 (sentinel value for in-memory mode).
 *
 * Opt-in: instantiate directly with `new MemoryBusTui()`. `BusTui.connect()`
 * no longer falls back to this class automatically.
 *
 * No WebSocket connection needed — messages flow through the shared
 * in-process EventBus. Wildcard patterns are NOT supported; use the
 * real Go bus for cross-process IPC and wildcard matching.
 */
export class MemoryBusTui extends BusTui {
  private memorySubs: Map<string, Unsubscribe> = new Map();

  constructor() {
    super(0); // port 0 = in-memory mode
  }

  override subscribe(pattern: string, callback: BusCallback): Unsubscribe {
    const unsub = memoryBus.subscribe(pattern, callback);
    this.memorySubs.set(pattern, unsub);
    return unsub;
  }

  override publish(channel: string, payload: unknown): void {
    memoryBus.publish(channel, payload);
  }

  override close(): void {
    for (const [, unsub] of this.memorySubs) {
      unsub();
    }
    this.memorySubs.clear();
  }
}

/**
 * Match a channel name against a pattern.
 * `+` matches exactly one path segment.
 */
function matchPattern(pattern: string, channel: string): boolean {
  const patSegs = pattern.split("/");
  const chanSegs = channel.split("/");

  if (patSegs.length !== chanSegs.length) return false;

  for (let i = 0; i < patSegs.length; i++) {
    if (patSegs[i] === "+") continue;
    if (patSegs[i].toLowerCase() !== chanSegs[i].toLowerCase()) return false;
  }
  return true;
}
