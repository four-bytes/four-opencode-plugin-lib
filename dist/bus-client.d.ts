/**
 * Server-side client for the plugin bus.
 * Plugins import BusClient, publish messages via HTTP POST.
 *
 * Falls back to an in-memory EventBus when the Go binary is not available.
 *
 * Usage:
 *   const bus = await BusClient.connect();
 *   await bus.publish("tbg/status", { cumulative: 1234 });
 */
export declare class BusClient {
    protected port: number;
    private baseUrl;
    protected constructor(port: number);
    /**
     * Connect to the plugin bus. Auto-starts the bus binary if not running.
     * Falls back to in-memory EventBus if no binary is available.
     * @param timeoutMs — Max time to wait for bus to start (default 5000ms)
     */
    static connect(timeoutMs?: number): Promise<BusClient>;
    /**
     * Resolve the bus binary path.
     * Prefers ~/.local/bin/bus over bare "bus" (which relies on PATH).
     */
    private static findBusBinary;
    /**
     * Spawn the bus binary and read the port from stdout.
     * Guarded by a module-level spawn lock so concurrent connect() calls share
     * the same in-flight spawn instead of forking multiple bus processes.
     */
    private static startBus;
    /**
     * Inner spawn implementation — wraps the child process in a Promise.
     * Kept separate from startBus() so the spawn lock can be released cleanly.
     */
    private static spawnBus;
    /**
     * Check if bus at given port is healthy.
     */
    private static checkHealth;
    /**
     * Publish a message to a channel.
     * @param channel — Channel name (e.g., "tbg/ses_abc/status")
     * @param payload — Message payload (any JSON-serializable value)
     */
    publish(channel: string, payload: unknown): Promise<void>;
    /**
     * Check if the bus is healthy.
     */
    healthCheck(): Promise<boolean>;
    /** The port the bus is running on (0 = in-memory mode) */
    get activePort(): number;
    /**
     * Close the client. No-op for plain HTTP clients — each call already uses
     * a fresh request. Defined here so ScopedBusClient can override it as a
     * no-op without accidentally inheriting a future lifecycle teardown.
     */
    close(): void;
    /** Returns a scoped client that prefixes all channels with {service}/ */
    forService(name: string): BusClient;
    /** Returns a scoped client that prefixes all channels with {sessionId}/ */
    forSession(id: string): BusClient;
}
