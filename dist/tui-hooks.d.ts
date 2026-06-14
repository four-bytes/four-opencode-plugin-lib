/**
 * Reactive bus subscription for TUI plugins.
 *
 * Connects to the bus once (onMount), then reactively subscribes
 * to a session-scoped channel whenever both the bus connection
 * and session ID are available.
 *
 * Handles cleanup on session change and component unmount.
 */
export declare function useServiceBus(service: string, sessionId: () => string | undefined, channel: string, onMessage: (payload: unknown) => void): void;
