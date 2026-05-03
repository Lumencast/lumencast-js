// Minimal LSDP/1 client used by the Svelte adapter.
//
// Headless — no DOM, no rendering. Exposes a small surface :
//   - subscribe via the lsdp.v1 WebSocket subprotocol
//   - apply incoming snapshot/delta frames into a leaf-state map
//   - reconnect with exponential backoff on close
//   - send input frames
//
// Sibling of @lumencast/runtime's transport layer, but stripped to the
// pieces a framework adapter needs. Reuses @lumencast/protocol for
// codec + sequence tracking ; we just orchestrate.

import {
  WS_SUBPROTOCOL,
  decodeServerFrame,
  encodeFrame,
  SequenceTracker,
  input as inputFrame,
  subscribe as subscribeFrame,
  type ClientFrame,
  type Patch,
  type ServerFrame,
} from "@lumencast/protocol";

/** Connection status reported to the host. */
export type Status = "disconnected" | "connecting" | "live";

/** A single bag of named values keyed by leaf path. */
export type LeafState = Record<string, unknown>;

export interface ClientOptions {
  /** WebSocket URL (must be ws:// or wss:// and end at the LSDP endpoint). */
  url: string;
  /** Authentication token, async-resolvable. */
  token: string | (() => Promise<string>);
  /** Optional scene name (test mode). */
  scene?: string;
  /** Optional session identifier (test-mode harness). */
  session?: string;
  /** Override WebSocket constructor (for tests / non-browser hosts). */
  webSocketImpl?: typeof WebSocket;
  /** Initial reconnect delay in ms. Doubled per attempt up to 30 s. */
  reconnectInitialMs?: number;
  /** Cap on the reconnect delay. */
  reconnectMaxMs?: number;
}

export interface ClientCallbacks {
  onStatus: (status: Status) => void;
  /** Called whenever the leaf state changes — receives a fresh defensive copy. */
  onState: (state: LeafState) => void;
  /** Called on every error frame from the server. */
  onError?: (code: string, message: string, recoverable: boolean) => void;
}

/** Headless client handle — used by framework adapters to drive reactivity. */
export interface Client {
  /** Send an `input` frame. Patches are forwarded as-is. */
  send(patches: Patch[]): void;
  /** Cleanly close the connection — no further callbacks fire. */
  dispose(): void;
}

const DEFAULT_INITIAL_MS = 500;
const DEFAULT_MAX_MS = 30_000;

/**
 * Open a long-lived LSDP/1 subscription. Returns a `Client` handle.
 * Status callbacks fire synchronously on every transition ; state
 * callbacks fire after every snapshot / delta.
 */
export function createClient(opts: ClientOptions, cb: ClientCallbacks): Client {
  const Ws = opts.webSocketImpl ?? globalThis.WebSocket;
  if (!Ws) {
    throw new Error(
      "@lumencast/runtime-*: no WebSocket implementation available. Pass `webSocketImpl` for non-browser hosts.",
    );
  }
  const initialMs = opts.reconnectInitialMs ?? DEFAULT_INITIAL_MS;
  const maxMs = opts.reconnectMaxMs ?? DEFAULT_MAX_MS;

  let ws: WebSocket | null = null;
  let active = true;
  let backoffMs = initialMs;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const tracker = new SequenceTracker();
  let state: LeafState = {};

  const setStatus = (status: Status): void => {
    cb.onStatus(status);
  };

  const emitState = (): void => {
    // Hand out a defensive shallow copy ; framework reactivity layers
    // typically react on identity changes, not deep diffing.
    cb.onState({ ...state });
  };

  const open = async (): Promise<void> => {
    if (!active) return;
    setStatus("connecting");

    let token: string;
    try {
      token = typeof opts.token === "function" ? await opts.token() : opts.token;
    } catch (err) {
      cb.onError?.("auth-token-resolve", (err as Error).message, false);
      scheduleReconnect();
      return;
    }
    if (!active) return;

    try {
      ws = new Ws(opts.url, [WS_SUBPROTOCOL]);
    } catch (err) {
      cb.onError?.("ws-open", (err as Error).message, false);
      scheduleReconnect();
      return;
    }

    ws.addEventListener("open", () => {
      if (!ws) return;
      const frame: ClientFrame = subscribeFrame({
        token,
        ...(opts.scene !== undefined ? { scene: opts.scene } : {}),
        ...(opts.session !== undefined ? { session: opts.session } : {}),
      });
      ws.send(encodeFrame(frame));
    });

    ws.addEventListener("message", (event: MessageEvent) => {
      if (!active) return;
      let frame: ServerFrame | null;
      try {
        const raw = typeof event.data === "string" ? event.data : "";
        frame = decodeServerFrame(raw);
      } catch (err) {
        cb.onError?.("decode", (err as Error).message, true);
        return;
      }
      if (frame === null) {
        cb.onError?.("decode", "unrecognised server frame", true);
        return;
      }
      handleServerFrame(frame);
    });

    ws.addEventListener("close", () => {
      ws = null;
      if (!active) return;
      setStatus("disconnected");
      scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      // The WS will close right after — let the close handler drive
      // reconnect to avoid double-scheduling.
    });
  };

  const handleServerFrame = (frame: ServerFrame): void => {
    switch (frame.type) {
      case "snapshot": {
        // Snapshots reset the seq window — accept whatever seq.
        tracker.reset();
        tracker.observe(frame.seq);
        state = { ...frame.state };
        emitState();
        backoffMs = initialMs;
        setStatus("live");
        break;
      }
      case "delta": {
        const obs = tracker.observe(frame.seq);
        if (obs.kind === "gap") {
          // Sequence gap → close and let reconnect grab a fresh
          // snapshot. Per LSDP/1 §6.
          ws?.close(1000, "seq-gap");
          tracker.reset();
          return;
        }
        if (obs.kind === "duplicate") {
          // Replay — drop silently.
          return;
        }
        for (const p of frame.patches) {
          state[p.path] = p.value;
        }
        emitState();
        break;
      }
      case "scene_changed": {
        // The fresh snapshot that follows is the source of truth ;
        // we just reset our local sequence tracker.
        tracker.reset();
        break;
      }
      case "error": {
        cb.onError?.(frame.code, frame.message, frame.recoverable);
        break;
      }
      case "pong":
      default:
        // Forward-compat : ignore unknown / housekeeping frames.
        break;
    }
  };

  const scheduleReconnect = (): void => {
    if (!active) return;
    if (reconnectTimer) return;
    const delay = backoffMs;
    backoffMs = Math.min(maxMs, backoffMs * 2);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void open();
    }, delay);
  };

  const send = (patches: Patch[]): void => {
    if (!active || !ws || ws.readyState !== ws.OPEN) return;
    if (patches.length === 0) return;
    const frame: ClientFrame = inputFrame(patches);
    ws.send(encodeFrame(frame));
  };

  const dispose = (): void => {
    active = false;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      try {
        ws.close(1000, "dispose");
      } catch {
        // ignore
      }
      ws = null;
    }
  };

  void open();
  return { send, dispose };
}
