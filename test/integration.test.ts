/**
 * Integration tests for the plugin bus (Go binary path).
 *
 * These tests start the real Go bus binary and test the full HTTP+WebSocket path.
 *
 * NOTE: `BusTui.connect()` throws if the Go binary is not reachable.
 * Callers that explicitly want in-process mode should construct
 * `MemoryBusTui` (or `MemoryBusClient`) directly.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { spawn, type Subprocess } from "bun";
import { BusClient } from "../src/bus-client.js";
import { BusTui } from "../src/bus-tui.js";
import { BUS_PORT } from "../src/types.js";

const BUS_BINARY = "/home/robby/.local/bin/four-local-bus";

describe("Plugin Bus Integration", () => {
  let busProcess: Subprocess | null = null;

  beforeAll(async () => {
    // Start bus binary
    busProcess = spawn([BUS_BINARY], {
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for bus to be ready (fixed port 4099)
    await new Promise((r) => setTimeout(r, 1000));
  }, 10000);

  afterAll(async () => {
    if (busProcess) {
      busProcess.kill();
      await busProcess.exited;
    }
  });

  it("starts and reports healthy", async () => {
    const client = await BusClient.connect();
    const healthy = await client.healthCheck();
    expect(healthy).toBe(true);
    expect(client.activePort).toBe(BUS_PORT);
  });

  it("publishes and receives via last-value cache", async () => {
    const client = await BusClient.connect();

    // Publish a message
    await client.publish("test/integration", { hello: "world", count: 42 });

    // Connect BusTui and subscribe — should receive cached message
    const tui = await BusTui.connect();

    const received: unknown[] = [];
    tui.subscribe("test/integration", (msg) => {
      received.push(msg.payload);
    });

    // Wait for message delivery (last-value cache delivers on subscribe)
    await new Promise((r) => setTimeout(r, 500));

    expect(received.length).toBe(1);
    expect((received[0] as any).hello).toBe("world");
    expect((received[0] as any).count).toBe(42);

    tui.close();
  });

  it("delivers real-time messages after subscription", async () => {
    const client = await BusClient.connect();
    const tui = await BusTui.connect();

    const received: unknown[] = [];
    tui.subscribe("test/realtime", (msg) => {
      received.push(msg.payload);
    });

    // Wait for subscription to register on the server
    await new Promise((r) => setTimeout(r, 200));

    // Publish after subscription
    await client.publish("test/realtime", { live: true });

    await new Promise((r) => setTimeout(r, 500));

    expect(received.length).toBe(1);
    expect((received[0] as any).live).toBe(true);

    tui.close();
  });

  it("supports wildcard channel matching", async () => {
    const client = await BusClient.connect();
    const tui = await BusTui.connect();

    const received: unknown[] = [];
    tui.subscribe("test/+/wildcard", (msg) => {
      received.push({ channel: msg.channel, payload: msg.payload });
    });

    await new Promise((r) => setTimeout(r, 200));

    await client.publish("test/foo/wildcard", { id: 1 });
    await client.publish("test/bar/wildcard", { id: 2 });
    await client.publish("test/baz/other", { id: 3 }); // should NOT match

    await new Promise((r) => setTimeout(r, 500));

    expect(received.length).toBe(2);
    expect((received[0] as any).payload.id).toBe(1);
    expect((received[1] as any).payload.id).toBe(2);

    tui.close();
  });

  it("handles unsubscription", async () => {
    const client = await BusClient.connect();
    const tui = await BusTui.connect();

    const received: unknown[] = [];
    const unsub = tui.subscribe("test/unsub", (msg) => {
      received.push(msg.payload);
    });

    await new Promise((r) => setTimeout(r, 200));

    // First publish — should be received
    await client.publish("test/unsub", { n: 1 });
    await new Promise((r) => setTimeout(r, 200));

    // Unsubscribe
    unsub();
    await new Promise((r) => setTimeout(r, 200));

    // Second publish — should NOT be received
    await client.publish("test/unsub", { n: 2 });
    await new Promise((r) => setTimeout(r, 200));

    expect(received.length).toBe(1);
    expect((received[0] as any).n).toBe(1);

    tui.close();
  });
});
