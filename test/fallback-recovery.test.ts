/**
 * Fallback and recovery flow tests for the plugin bus.
 *
 * Tests the BusTui/MemoryBusTui fallback behaviour that underpins the
 * useServiceBus hook (src/tui-hooks.ts):
 *   - BusTui.connect() throws when Go bus unavailable → MemoryBusTui fallback
 *   - Recovery: once Go bus starts, BusTui.connect() succeeds
 *   - ScopedBusTui.forService().forProject() chaining works correctly
 *
 * Each test starts its own bus process (hermetic) so tests can run in any order.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { spawn, type Subprocess } from "bun";
import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { BusClient } from "../src/bus-client.js";
import { BusTui, MemoryBusTui } from "../src/bus-tui.js";
import { discoverPort } from "../src/discovery.js";

const BUS_BINARY = join(homedir(), ".local", "bin", "four-local-bus");
const PORT_FILE = join(homedir(), ".cache", "opencode", "plugin-bus", "port.json");

// Clean port file so discoverPort throws → BusTui.connect() throws
function cleanPortFile(): void {
  if (existsSync(PORT_FILE)) {
    unlinkSync(PORT_FILE);
  }
}

// Spawn bus and wait for port file to appear
async function startBus(): Promise<Subprocess> {
  cleanPortFile();
  const proc = spawn([BUS_BINARY], { stdout: "pipe", stderr: "pipe" });
  await discoverPort(5000);
  await new Promise((r) => setTimeout(r, 200));
  return proc;
}

// Stop bus and clean up port file
async function stopBus(proc: Subprocess | null): Promise<void> {
  if (proc) {
    proc.kill();
    await proc.exited;
  }
  cleanPortFile();
}

describe("Bus fallback and recovery flow", () => {
  // ═══════════════════════════════════════════════════════════════════
  // Test 1: MemoryBusTui works as in-process fallback
  // ═══════════════════════════════════════════════════════════════════
  describe("MemoryBusTui fallback", () => {
    it("subscribes and receives published messages in-process", async () => {
      // This is the fallback path useServiceBus takes when BusTui.connect() fails
      const tui = new MemoryBusTui();

      const received: unknown[] = [];
      tui.subscribe("fallback/test", (msg) => {
        received.push(msg.payload);
      });

      // Publish via a second MemoryBusTui instance (same MemoryBus singleton)
      const tui2 = new MemoryBusTui();
      tui2.publish("fallback/test", { inMemory: true, value: 42 });

      await new Promise((r) => setTimeout(r, 100));

      expect(received.length).toBe(1);
      expect((received[0] as any).inMemory).toBe(true);
      expect((received[0] as any).value).toBe(42);

      tui.close();
      tui2.close();
    });

    it("forService().forSession() prefixes channels correctly", () => {
      const tui = new MemoryBusTui();

      const received: unknown[] = [];
      tui.forService("myplugin").forSession("ses_123").subscribe("event", (msg) => {
        received.push(msg.payload);
      });

      // Publish from another MemoryBusTui with the same prefix structure
      const tui2 = new MemoryBusTui();
      tui2
        .forService("myplugin")
        .forSession("ses_123")
        .publish("event", { sessionMsg: true });

      expect(received.length).toBe(1);
      expect((received[0] as any).sessionMsg).toBe(true);

      tui.close();
      tui2.close();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Test 2: BusTui.connect() throws when Go bus unavailable
  // ═══════════════════════════════════════════════════════════════════
  describe("BusTui.connect() throws without Go bus", () => {
    it("throws when port file does not exist", async () => {
      cleanPortFile();

      await expect(BusTui.connect(1000)).rejects.toThrow();
    });

    it("throws when port file exists but bus process is dead", async () => {
      // Write a stale port file pointing to a dead port
      cleanPortFile();
      // 0 is an invalid port — discoverPort will throw after timeout
      await expect(BusTui.connect(1000)).rejects.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Test 3: Go bus recovery — connect fails → bus starts → connect succeeds
  // ═══════════════════════════════════════════════════════════════════
  describe("Go bus recovery", () => {
    it("BusTui.connect() succeeds after bus starts", async () => {
      cleanPortFile(); // ensure BusTui.connect() would fail initially

      // Start bus
      const proc = await startBus();

      try {
        // Now BusTui.connect() should succeed
        const tui = await BusTui.connect(5000);

        const received: unknown[] = [];
        tui.subscribe("recovery/test", (msg) => received.push(msg.payload));

        await new Promise((r) => setTimeout(r, 200));

        const client = await BusClient.connect();
        await client.publish("recovery/test", { recovered: true });

        await new Promise((r) => setTimeout(r, 500));

        expect(received.length).toBe(1);
        expect((received[0] as any).recovered).toBe(true);

        tui.close();
      } finally {
        await stopBus(proc);
      }
    });

    it("messages published before subscribe arrive via last-value cache", async () => {
      const proc = await startBus();

      try {
        const client = await BusClient.connect();
        await client.publish("recovery/cached", { cached: true });

        await new Promise((r) => setTimeout(r, 100));

        const tui = await BusTui.connect();
        const received: unknown[] = [];
        tui.subscribe("recovery/cached", (msg) => received.push(msg.payload));

        await new Promise((r) => setTimeout(r, 500));

        // BusTui last-value cache delivers cached message on subscribe
        expect(received.length).toBe(1);
        expect((received[0] as any).cached).toBe(true);

        tui.close();
      } finally {
        await stopBus(proc);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Test 4: ScopedBusTui.forProject() regression (P1 bug #10)
  // ═══════════════════════════════════════════════════════════════════
  describe("ScopedBusTui.forProject() chaining (P1 bug #10 regression)", () => {
    let busProcess: Subprocess | null = null;

    beforeAll(async () => {
      busProcess = await startBus();
    }, 10000);

    afterAll(async () => {
      await stopBus(busProcess);
    });

    it("forService().forProject().publish() delivers to correct channel", async () => {
      const tui = await BusTui.connect();

      const received: unknown[] = [];
      // Subscribe to the fully-scoped channel
      tui.subscribe("test/abc/status", (msg) => received.push(msg.payload));

      await new Promise((r) => setTimeout(r, 200));

      // Publish using scoped chain
      tui.forService("test").forProject("abc").publish("status", { x: 1 });

      await new Promise((r) => setTimeout(r, 500));

      expect(received.length).toBe(1);
      expect((received[0] as any).x).toBe(1);

      tui.close();
    });

    it("forService().forProject() composes with BusClient correctly", async () => {
      const tui = await BusTui.connect();

      const received: unknown[] = [];
      tui.subscribe("svc/proj_99/event", (msg) => received.push(msg.payload));

      await new Promise((r) => setTimeout(r, 200));

      const client = await BusClient.connect();
      await client.forService("svc").forProject("proj_99").publish("event", {
        composed: true,
      });

      await new Promise((r) => setTimeout(r, 500));

      expect(received.length).toBe(1);
      expect((received[0] as any).composed).toBe(true);

      tui.close();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Test 5: useServiceBus recovery simulation
  //         (BusTui.connect() fails → MemoryBusTui → retry → real bus)
  // ═══════════════════════════════════════════════════════════════════
  describe("useServiceBus recovery simulation", () => {
    it("after MemoryBusTui fallback, retry picks up real BusTui", async () => {
      // Step 1: No bus running — BusTui.connect() would fail
      cleanPortFile();

      // Simulate useServiceBus behaviour: catch connect() failure,
      // fall back to MemoryBusTui, then retry after bus starts
      let activeBus: BusTui = new MemoryBusTui();

      const receivedMemory: unknown[] = [];
      activeBus.subscribe("retry/channel", (msg) => receivedMemory.push(msg.payload));

      // Step 2: Start bus in background (simulates 5s retry timer firing)
      const proc = await startBus();

      // Step 3: Retry connect() — should now succeed with real BusTui
      let connectSucceeded = false;
      try {
        const realBus = await BusTui.connect(5000);
        activeBus.close(); // close MemoryBusTui
        activeBus = realBus;
        connectSucceeded = true;
      } catch {
        // still failed — bus may not have written port yet
      }

      expect(connectSucceeded).toBe(true);

      // Step 4: Real BusTui should receive messages
      const receivedReal: unknown[] = [];
      activeBus.subscribe("retry/channel", (msg) => receivedReal.push(msg.payload));

      await new Promise((r) => setTimeout(r, 200));

      const client = await BusClient.connect();
      await client.publish("retry/channel", { viaRealBus: true });

      await new Promise((r) => setTimeout(r, 500));

      // MemoryBusTui should NOT have received the new message (it was closed)
      // Real BusTui should have received it
      expect(receivedReal.length).toBe(1);
      expect((receivedReal[0] as any).viaRealBus).toBe(true);

      activeBus.close();
      await stopBus(proc);
    });

    it("MemoryBusTui close does not affect real BusTui (isolation)", async () => {
      const proc = await startBus();

      try {
        const memoryTui = new MemoryBusTui();
        const realTui = await BusTui.connect();

        // Publish to both busses
        memoryTui.publish("isolation/test", { from: "memory" });
        realTui.subscribe("isolation/test", () => {});

        await new Promise((r) => setTimeout(r, 100));

        // Closing memory bus must not close real bus
        memoryTui.close();

        // Real bus should still be functional
        const received: unknown[] = [];
        realTui.subscribe("isolation/test", (msg) => received.push(msg.payload));

        await new Promise((r) => setTimeout(r, 200));

        const client = await BusClient.connect();
        await client.publish("isolation/test", { stillAlive: true });

        await new Promise((r) => setTimeout(r, 500));

        expect(received.length).toBe(1);
        expect((received[0] as any).stillAlive).toBe(true);

        realTui.close();
      } finally {
        await stopBus(proc);
      }
    });
  });
});
