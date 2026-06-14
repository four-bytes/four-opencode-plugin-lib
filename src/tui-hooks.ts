import { createSignal, createEffect, onMount, onCleanup } from "solid-js";
import { BusTui } from "./bus-tui.js";

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
          if (!disposed) retryTimeout = setTimeout(tryConnect, 5000);
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

    let confirmed = false;

    const unsub = b
      .forService(service)
      .forSession(sid)
      .subscribe(channel, (envelope) => {
        confirmed = true;
        cancelPingRetry();
        onMessage(envelope.payload);
      });

    // Ping immediately, then retry every 2s until the worker responds.
    const sendPing = () => b.forService(service).forSession(sid).publish("ping", { ts: Date.now() });
    sendPing();
    pingTimer = setInterval(() => {
      if (confirmed) { cancelPingRetry(); return; }
      sendPing();
    }, 2000);

    onCleanup(() => {
      cancelPingRetry();
      unsub?.();
    });
  });

  onCleanup(() => {
    cancelPingRetry();
    busTui()?.close();
  });
}
