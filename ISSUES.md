**Status:** Last reviewed 2026-06-14. 2/2 fixed (brain), 3/3 fixed (plugin-lib), 2/2 fixed (local-bus), 2/2 fixed (context-curator).

# Known Issues

## #1 — TUI reconnect retries dead port instead of re-discovering

**Symptom:** After the bus restarts (idle-timeout shutdown → new spawn on different port),
the TUI status bar stays stuck on "connecting…" forever. Brain publishes arrive at the new
port; TUI keeps knocking on the old one.

**Root cause:** `BusTui.scheduleReconnect()` calls `this.open()` which uses `this.port` —
the port captured at initial `connect()` time. It never reads the discovery file again, so
a bus restart on a new port is invisible to the TUI.

**Location:** `src/bus-tui.ts` — `scheduleReconnect()` (line ~164).

**Fix:** Before calling `this.open()`, re-read the discovery file and update `this.port` if
a new port is found. Fall back to the current port if discovery fails (bus not yet restarted).

```typescript
private scheduleReconnect(): void {
  if (this.closed) return;
  this.reconnectTimer = setTimeout(async () => {
    if (this.closed) return;
    try {
      // Re-discover — bus may have restarted on a different port.
      const newPort = await discoverPort(2000).catch(() => this.port);
      this.port = newPort;
      await this.open();
      // success: ws.onopen already resets reconnectDelay to 1000
    } catch {
      // Failed — back off for next attempt
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    }
  }, this.reconnectDelay);
}
```

Note: move the backoff increment into the `catch` block (currently it runs unconditionally,
doubling the delay even on successful reconnect).

---

✅ FIXED — commit b96489a (`discoverPort` in `scheduleReconnect`).

## #2 — Spawn lock missing: concurrent BusClient.connect() calls spawn duplicate buses

**Symptom:** If two plugin instances call `BusClient.connect()` at the same moment (e.g.,
two opencode windows starting simultaneously), both may see no port file, both call
`startBus()`, and two bus binaries are spawned. The "loser" writes to `port.json` first,
gets overwritten, and runs forever (see `four-local-bus` ISSUES #1 for the orphan side).

**Root cause:** No mutual-exclusion guard around `startBus()`. The check
(`discoverPort(500)` → health check → spawn) is a non-atomic read-check-act sequence.

**Location:** `src/bus-client.ts` — `connect()` / `startBus()`.

**Fix:** Add a module-level promise that deduplicates concurrent spawn attempts:

```typescript
let _spawnLock: Promise<number> | null = null;

// Inside connect(), replace the direct startBus() call:
if (!_spawnLock) {
  _spawnLock = BusClient.startBus(timeoutMs).finally(() => {
    _spawnLock = null;
  });
}
const port = await _spawnLock;
return new BusClient(port);
```

---

✅ FIXED — commit b96489a (`_spawnLock` promise deduplicating concurrent starts).

## #3 — MemoryBusTui fallback is a dead end (no upgrade to real bus)

**Symptom:** If the TUI mounts before the bus port file exists (timing race on startup),
`BusTui.connect()` times out after 5 s and returns a `MemoryBusTui`. The TUI never retries
the real bus. Brain (a different process) publishes to the real Go bus; TUI consumes from
an in-process memory bus that never receives those messages. Status bar shows "connecting…"
for the session lifetime.

**Root cause:** `BusTui.connect()` catches the `discoverPort` timeout and returns
`MemoryBusTui` as a permanent fallback with no retry path.

**Location:** `src/bus-tui.ts` — `connect()` (line ~43).

**Fix:** Instead of returning `MemoryBusTui`, implement periodic retry in a real `BusTui`
instance. The initial timeout can be shorter (e.g., 2 s) to stay responsive; reconnect
logic (with re-discovery, see Issue #1) then handles the retry naturally.

The original `scheduleReconnect()` approach was replaced in commit ccde741:
`BusTui.connect()` now throws on failure instead of returning a reconnect-capable instance.
Use `useServiceBus` (commit 1879f2b) for reactive bus subscriptions in TUI contexts.

`scheduleReconnect()` with re-discovery (Issue #1 fix) then handles finding the bus once
it appears, without needing a separate `MemoryBusTui` class.

---

✅ FIXED — commit ccde741 (`BusTui.connect()` throws on missing bus; `useServiceBus` is the recommended path).

## Lifecycle patterns (should live in this lib, not in each plugin)

The following patterns are currently implemented ad-hoc in individual plugins
(e.g., `four-opencode-brain/src/status.ts`). They should be encapsulated here:

| Pattern | Where needed | Current state |
|---------|-------------|---------------|
| Start bus on plugin init, reuse if already running | `BusClient.connect()` | ✅ done |
| Spawn lock — no concurrent starts | `BusClient.connect()` | ✅ done (#2) |
| TUI: reconnect with port re-discovery | `BusTui.scheduleReconnect()` | ✅ done (Issue #1) |
| TUI: don't dead-end in MemoryBusTui | `BusTui.connect()` | ✅ done (Issue #3) |
| Server: clean shutdown when opencode exits | Go idle timer + explicit `close()` | ⚠️ idle only |

✅ `useServiceBus` hook extracted — commit 1879f2b (reactive bus subscription for TUIs;
replaces ad-hoc `MemoryBusTui` + reconnect juggling in plugin code).
