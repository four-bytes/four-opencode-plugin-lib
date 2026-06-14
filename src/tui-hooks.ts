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
  let unmounted = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    BusTui.connect()
      .then((b) => {
        if (unmounted) {
          b.close();
          return;
        }
        setBusTui(b);
      })
      .catch(() => {
        if (!unmounted) {
          retryTimer = setTimeout(connect, 5000); // retry every 5s
        }
      });
  };

  // Connect to bus once on mount (with retry on failure)
  onMount(() => connect());

  // Reactively subscribe when bus and session are both ready
  createEffect(() => {
    const b = busTui();
    const sid = sessionId();
    if (!b || !sid) return;

    const unsub = b
      .forService(service)
      .forSession(sid)
      .subscribe(channel, (envelope) => {
        onMessage(envelope.payload);
      });

    // Publish ping so the worker knows our session ID (continue mode fix)
    b.forService(service).forSession(sid).publish("ping", { ts: Date.now() });

    onCleanup(() => unsub?.());
  });

  // Cleanup bus on unmount — guard against late connect(), cancel retry
  onCleanup(() => {
    unmounted = true;
    if (retryTimer) clearTimeout(retryTimer);
    busTui()?.close();
  });
}
