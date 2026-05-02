// LSDP/1 WebSocket client.
//
// Lifecycle (LSDP/1 §6):
//   1. open() — opens the WS with subprotocol `lsdp.v1`
//   2. on open: send `subscribe` with the resolved token (and scene + session
//      for test mode)
//   3. server replies `snapshot` (seq=1) → emit onSnapshot
//   4. subsequent `delta` / `scene_changed` / `error` / `pong` are dispatched
//   5. on a sequence gap → close + reconnect (fresh snapshot)
//   6. on close → reconnect with backoff, unless close was triggered by close()
//   7. setToken() opens a parallel WS with the new token; once its snapshot
//      lands, atomically swap and close the old socket — no rendering gap

import {
  decodeServerFrame,
  encodeFrame,
  LumencastError,
  SequenceTracker,
  WS_SUBPROTOCOL,
  input as inputFrame,
  subscribe as subscribeFrame,
  type DeltaFrame,
  type ErrorCode,
  type ErrorFrame,
  type Patch,
  type SceneChangedFrame,
  type SnapshotFrame,
} from "@lumencast/protocol";
import type { LumencastToken } from "../types.js";
import {
  createReconnectSchedule,
  type ReconnectSchedule,
  type ReconnectScheduleOptions,
} from "./reconnect.js";

export type ConnectionStatus = "disconnected" | "connecting" | "live";

export interface WsClientOptions {
  url: string;
  token: LumencastToken;
  /** Optional scene identifier (test mode). */
  scene?: string;
  /** Optional session identifier (test mode). */
  session?: string;
  /** Override the WebSocket constructor (for tests / non-browser hosts). */
  webSocketImpl?: typeof WebSocket;
  /** Reconnect tuning. */
  reconnect?: ReconnectScheduleOptions;
  /** Inject scheduler for tests. */
  scheduler?: {
    setTimeout: typeof globalThis.setTimeout;
    clearTimeout: typeof globalThis.clearTimeout;
  };

  onStatus?: (status: ConnectionStatus) => void;
  onSnapshot?: (frame: SnapshotFrame) => void;
  onDelta?: (frame: DeltaFrame) => void;
  onSceneChanged?: (frame: SceneChangedFrame) => void;
  onServerError?: (frame: ErrorFrame) => void;
  /** Wire-level / codec / unrecoverable errors. */
  onTransportError?: (err: TransportError) => void;
}

export class TransportError extends Error {
  public readonly recoverable: boolean;
  public readonly code: ErrorCode;
  public override readonly cause?: unknown;
  constructor(
    message: string,
    recoverable: boolean,
    code: ErrorCode = "INTERNAL",
    cause?: unknown,
  ) {
    super(message);
    this.name = "TransportError";
    this.recoverable = recoverable;
    this.code = code;
    this.cause = cause;
  }
}

type Timer = ReturnType<typeof setTimeout>;

interface InternalScheduler {
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
}

export class WsClient {
  private status: ConnectionStatus = "disconnected";
  private socket: WebSocket | null = null;
  private token: LumencastToken;
  private readonly url: string;
  private readonly WebSocketCtor: typeof WebSocket;
  private readonly schedule: ReconnectSchedule;
  private readonly seq = new SequenceTracker();
  private readonly opts: WsClientOptions;
  private readonly scheduler: InternalScheduler;

  private reconnectTimer: Timer | null = null;
  private active = true;

  constructor(opts: WsClientOptions) {
    this.opts = opts;
    this.url = opts.url;
    this.token = opts.token;
    const ctor = opts.webSocketImpl ?? globalThis.WebSocket;
    if (!ctor) {
      throw new TypeError(
        "Lumencast WsClient: no WebSocket implementation found in this environment",
      );
    }
    this.WebSocketCtor = ctor;
    this.schedule = createReconnectSchedule(opts.reconnect);
    this.scheduler = opts.scheduler ?? {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    };
  }

  /** Open and start the connection lifecycle. Idempotent. */
  start(): void {
    if (!this.active) return;
    if (this.socket || this.status === "connecting") return;
    void this.openSocket();
  }

  /** Send `input` patches to the server. No-op if not connected. */
  sendInput(patches: Patch[]): void {
    if (!this.socket || this.socket.readyState !== this.WebSocketCtor.OPEN) return;
    if (patches.length === 0) return;
    this.socket.send(encodeFrame(inputFrame(patches)));
  }

  /** Replace the auth token. Closes and reopens with the new token. */
  setToken(token: LumencastToken): void {
    this.token = token;
    if (!this.active) return;
    if (this.socket) {
      this.closeSocket();
      this.scheduleReconnect(true);
    }
  }

  /** Tear down for good. No more reconnect attempts. */
  close(): void {
    if (!this.active) return;
    this.active = false;
    this.cancelReconnect();
    this.closeSocket();
    this.setStatus("disconnected");
  }

  // --- internals --------------------------------------------------

  private async openSocket(): Promise<void> {
    if (!this.active) return;
    this.setStatus("connecting");

    let resolvedToken: string;
    try {
      resolvedToken = await resolveToken(this.token);
    } catch (err) {
      this.opts.onTransportError?.(
        new TransportError(
          `failed to resolve token: ${(err as Error).message}`,
          true,
          "AUTH_DENIED",
          err,
        ),
      );
      this.scheduleReconnect();
      return;
    }
    if (!this.active) return;

    let socket: WebSocket;
    try {
      socket = new this.WebSocketCtor(this.url, [WS_SUBPROTOCOL]);
    } catch (err) {
      this.opts.onTransportError?.(
        new TransportError(
          `failed to open WebSocket: ${(err as Error).message}`,
          true,
          "INTERNAL",
          err,
        ),
      );
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    socket.onopen = () => this.handleOpen(resolvedToken);
    socket.onmessage = (event) => this.handleMessage(event);
    socket.onerror = (event) => this.handleError(event);
    socket.onclose = (event) => this.handleClose(event);
  }

  private handleOpen(token: string): void {
    if (!this.socket) return;
    this.seq.reset();
    const frame = subscribeFrame({
      token,
      ...(this.opts.scene !== undefined ? { scene: this.opts.scene } : {}),
      ...(this.opts.session !== undefined ? { session: this.opts.session } : {}),
    });
    this.socket.send(encodeFrame(frame));
  }

  private handleMessage(event: MessageEvent): void {
    const data = typeof event.data === "string" ? event.data : "";
    if (!data) return;
    let frame;
    try {
      frame = decodeServerFrame(data);
    } catch (err) {
      const message = err instanceof LumencastError ? err.message : (err as Error).message;
      const code: ErrorCode = err instanceof LumencastError ? err.code : "INTERNAL";
      this.opts.onTransportError?.(new TransportError(`codec: ${message}`, true, code, err));
      this.closeSocket();
      this.scheduleReconnect();
      return;
    }
    if (frame === null) return; // unknown frame type — forward-compat ignore

    switch (frame.type) {
      case "snapshot": {
        const obs = this.seq.observe(frame.seq);
        if (obs.kind === "gap") {
          this.opts.onTransportError?.(
            new TransportError(`snapshot seq must be 1, got ${frame.seq}`, true, "VERSION_GAP"),
          );
          this.closeSocket();
          this.scheduleReconnect();
          return;
        }
        this.schedule.reset();
        this.setStatus("live");
        this.opts.onSnapshot?.(frame);
        return;
      }
      case "delta": {
        const obs = this.seq.observe(frame.seq);
        if (obs.kind === "gap") {
          this.opts.onTransportError?.(
            new TransportError(
              `sequence gap: expected ${this.seq.last + 1}, got ${frame.seq}`,
              true,
              "VERSION_GAP",
            ),
          );
          this.closeSocket();
          this.scheduleReconnect();
          return;
        }
        if (obs.kind === "duplicate") return; // silent drop per LSDP/1 §5
        this.opts.onDelta?.(frame);
        return;
      }
      case "scene_changed": {
        // The next snapshot resets seq to 1 — pre-reset the tracker so it accepts seq=1.
        this.seq.reset();
        this.opts.onSceneChanged?.(frame);
        return;
      }
      case "error": {
        this.opts.onServerError?.(frame);
        if (!frame.recoverable) this.close();
        return;
      }
      case "pong":
        return;
    }
  }

  private handleError(_event: Event): void {
    // The browser does not give us a real reason — `close` will follow.
  }

  private handleClose(event: CloseEvent): void {
    this.socket = null;
    if (!this.active) {
      this.setStatus("disconnected");
      return;
    }
    if (event.code === 4401 || event.code === 4403 || event.code === 1008) {
      // Auth-related close codes: not recoverable without operator intervention.
      this.opts.onTransportError?.(
        new TransportError(`server closed: ${event.code} ${event.reason}`, false, "AUTH_DENIED"),
      );
      this.close();
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(immediate = false): void {
    if (!this.active) return;
    this.cancelReconnect();
    const attempt = (this.schedule.attempt || 0) + 1;
    const delay = immediate ? 0 : this.schedule.delayFor(attempt);
    this.setStatus("disconnected");
    this.reconnectTimer = this.scheduler.setTimeout(() => {
      this.reconnectTimer = null;
      void this.openSocket();
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      this.scheduler.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private closeSocket(): void {
    if (this.socket) {
      try {
        this.socket.close(1000, "client closing");
      } catch {
        // ignore
      }
      this.socket = null;
    }
  }

  private setStatus(next: ConnectionStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.opts.onStatus?.(next);
  }
}

async function resolveToken(token: LumencastToken): Promise<string> {
  if (typeof token === "string") return token;
  return await token.fetch();
}
