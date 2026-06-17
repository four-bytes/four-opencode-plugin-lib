import { createSignal, createEffect, onMount, onCleanup } from "solid-js";
import { BusTui, MemoryBusTui } from "./bus-tui.js";

/**
 * Reactive bus subscription for TUI plugins.
 *
 * Connects to the bus once (onMount), then reactively subscribes
 * to a session-scoped channel whenever both the bus connection
 * and session ID are available.
 *
 * Cancellation-safe: if the component unmounts while a connect() is
 * in-flight, the resulting bus handle is closed immediately instead
 * of being stored. Retries connect() every 5s on failure.
 *
 * Handles cleanup on session change and component unmount.
 */
export function useServiceBus(
  service: string,
  sessionId: () => string | undefined,
  channel: string,
  onMessage: (payload: unknown) => void,
  opts?: { pollEndpoint?: string },
): void {
  const [busTui, setBusTui] = createSignal<BusTui | null>(null);
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const cancelPingRetry = () => {
    if (pingTimer !== null) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  };

  onMount(() => {
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const tryConnect = () => {
      BusTui.connect()
        .then((b) => {
          if (disposed) { b.close(); return; }
          setBusTui(b);
        })
        .catch(() => {
          if (disposed) return;
          // Same-process fallback only when no HTTP polling endpoint is configured.
          // When pollEndpoint is provided, leave bus null so HTTP polling activates.
          if (!opts?.pollEndpoint) {
            setBusTui(new MemoryBusTui());
            return;
          }
          // Polling mode: retry connecting to real bus so we can recover
          if (retryTimeout === null) {
            retryTimeout = setTimeout(() => {
              retryTimeout = null;
              tryConnect();
            }, 5000);
          }
        });
    };

    tryConnect();

    onCleanup(() => {
      disposed = true;
      if (retryTimeout !== null) clearTimeout(retryTimeout);
    });
  });

  createEffect(() => {
    const b = busTui();
    const sid = sessionId();
    cancelPingRetry();
    if (!b || !sid) return;

    // Skip WebSocket ping for in-memory bus
    const isMemoryBus = b instanceof MemoryBusTui;

    let confirmed = false;

    const unsub = b
      .forService(service)
      .forSession(sid)
      .subscribe(channel, (envelope) => {
        confirmed = true;
        cancelPingRetry();
        onMessage(envelope.payload);
      });

    // Only send ping for real WebSocket connections
    if (!isMemoryBus) {
      const sendPing = () => b.forService(service).forSession(sid).publish("ping", { ts: Date.now() });
      sendPing();
      pingTimer = setInterval(() => {
        if (confirmed) { cancelPingRetry(); return; }
        sendPing();
      }, 2000);
    }

    onCleanup(() => {
      cancelPingRetry();
      unsub?.();
    });
  });

  // Fallback 2: HTTP polling when no bus connection and endpoint is available
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let pollAbort: AbortController | null = null;

  createEffect(() => {
    const b = busTui();
    const sid = sessionId();

    // Stop polling only if we have a real bus connection. MemoryBusTui is
    // same-process only, so keep HTTP polling as the cross-process fallback.
    if (b && !(b instanceof MemoryBusTui)) {
      if (pollInterval !== null) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      return;
    }

    // Start polling if we have an endpoint but no bus
    if (!sid || !opts?.pollEndpoint) return;

    if (pollInterval !== null) return; // already polling

    pollInterval = setInterval(async () => {
      pollAbort?.abort();
      pollAbort = new AbortController();
      try {
        const res = await fetch(`${opts.pollEndpoint}/status`, { signal: pollAbort.signal });
        if (res.ok) {
          const data = await res.json();
          onMessage(data);
        }
      } catch {
        // endpoint not reachable — wait for next poll
      }
    }, 2000);

    onCleanup(() => {
      pollAbort?.abort();
      pollAbort = null;
      if (pollInterval !== null) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    });
  });

  onCleanup(() => {
    cancelPingRetry();
    busTui()?.close();
  });
}
