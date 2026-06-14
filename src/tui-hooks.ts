import { createSignal, createEffect, onMount, onCleanup } from "solid-js";
import { BusTui } from "./bus-tui";
import type { BusCallback } from "./types";

/**
 * Reactive bus subscription for TUI plugins.
 *
 * Connects to the bus once (onMount), then reactively subscribes
 * to a session-scoped channel whenever both the bus connection
 * and session ID are available.
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

  // Connect to bus once on mount
  onMount(() => {
    BusTui.connect()
      .then((b) => setBusTui(b))
      .catch(() => {
        // Bus unavailable — TUI shows connecting state
      });
  });

  // Reactively subscribe when bus and session are both ready
  createEffect(() => {
    const b = busTui();
    const sid = sessionId();
    if (!b || !sid) return;

    const unsub = b
      .forService(service)
      .forSession(sid)
      .subscribe(channel, ((envelope: { payload: unknown }) => {
        onMessage(envelope.payload);
      }) as BusCallback);

    onCleanup(() => unsub?.());
  });

  // Cleanup bus on unmount
  onCleanup(() => {
    busTui()?.close();
  });
}
