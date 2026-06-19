/** Fixed port for the Go bus server. Single process per user, no discovery needed. */
export declare const BUS_PORT = 4099;
/** Message envelope published on the plugin bus */
export interface BusEnvelope<C extends string = string, P = unknown> {
    channel: C;
    payload: P;
    ts: number;
}
/** Status returned by GET /health */
export interface BusHealth {
    status: "ok" | "error";
    uptime?: number;
}
/** Port discovery file content */
export interface PortInfo {
    port: number;
}
/** Callback for channel subscription */
export type BusCallback<C extends string = string, P = unknown> = (msg: BusEnvelope<C, P>) => void;
/** Unsubscribe function returned by subscribe() */
export type Unsubscribe = () => void;
