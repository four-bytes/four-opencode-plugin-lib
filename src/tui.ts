// Bus client — TUI entry point (P17b)
export { BusTui } from "./bus-tui.js";
export { MemoryBusTui } from "./bus-tui.js";
export { useServiceBus } from "./tui-hooks.js";
export type {
  BusEnvelope,
  BusHealth,
  PortInfo,
  BusCallback,
  Unsubscribe,
} from "./types.js";

export { deriveProjectId } from "./derive-project-id.js";

import { useServiceBus } from "./tui-hooks.js";
import { deriveProjectId } from "./derive-project-id.js";

/**
 * Project-scoped reactive bus subscription.
 * Derives a stable project ID from the directory path and delegates to useServiceBus.
 * Use when status is meaningful at project level (ingest, brain health, token budget).
 */
export function useProjectBus(
  service: string,
  directory: string,
  channel: string,
  onMessage: (payload: unknown) => void,
): void {
  const projectId = deriveProjectId(directory);
  useServiceBus(service, () => projectId, channel, onMessage);
}
