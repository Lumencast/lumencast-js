// HTTP + WebSocket server kit for LSDP/1.
//
// Single-scene at a time, single-process. The active scene is mutable so the
// interop test control plane can swap it via /test/setup without restarting
// the server.
//
// LSDP/1 spec compliance highlights:
//   - WebSocket subprotocol negotiation: `lsdp.v1`
//   - subscribe → snapshot(seq=1) → delta(seq=2,...)
//   - input frames validated against `authenticate()` decision + canWritePath()
//   - error frames carry codes from the closed taxonomy
//   - heartbeat: ping → pong

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  delta as deltaFrame,
  decodeClientFrame,
  encodeFrame,
  errorFrame,
  isProtocolErrorCode,
  LumencastError,
  pong,
  snapshot as snapshotFrame,
  WS_SUBPROTOCOL,
  type ErrorCode,
  type Patch,
  type SceneVersion,
} from "@lumencast/protocol";
import { canWritePath, defaultAuthenticate, type Authenticate, type AuthDecision } from "./auth.js";
import type { Scene } from "./scene.js";

export interface ServerConfig {
  /** TCP port to listen on. 0 = random. */
  port?: number;
  /** Hostname to bind. Defaults to 127.0.0.1. */
  host?: string;
  /** The initial scene this server serves. May be swapped via setActiveScene(). */
  scene: Scene;
  /** Resolves a SceneVersion to its LSML bundle JSON. May be swapped. */
  bundleProvider: (version: SceneVersion) => Promise<unknown> | unknown;
  /** Authenticate every subscribe; default accepts everything as `viewer`. */
  authenticate?: Authenticate;
  /** Optional ws path. Defaults to `/lsdp/v1`. */
  wsPath?: string;
  /** Optional bundle path prefix. Defaults to `/lsdp/v1/scenes`. */
  bundlePathPrefix?: string;
}

export interface ServerHandle {
  readonly wsUrl: string;
  readonly httpUrl: string;
  /**
   * Replace the active scene. Detaches every subscriber (they receive a 1012
   * "service restart" close so well-behaved clients reconnect cleanly).
   * Test/interop only — production code should never call this.
   */
  setActiveScene(scene: Scene): void;
  /** Replace the bundle provider. Test/interop only. */
  setBundleProvider(fn: (version: SceneVersion) => Promise<unknown> | unknown): void;
  /** Read the current active scene. */
  activeScene(): Scene;
  /** Drop all subscribers without replacing the scene. Test/interop only. */
  reset(): void;
  close(): Promise<void>;
}

interface Subscriber {
  ws: WebSocket;
  seq: number;
  decision: AuthDecision | null;
  unsubscribePatches: (() => void) | null;
}

export async function startServer(config: ServerConfig): Promise<ServerHandle> {
  const host = config.host ?? "127.0.0.1";
  const wsPath = config.wsPath ?? "/lsdp/v1";
  const bundlePathPrefix = config.bundlePathPrefix ?? "/lsdp/v1/scenes";
  const authenticate = config.authenticate ?? defaultAuthenticate;

  // Mutable refs — swappable via setActiveScene / setBundleProvider.
  let activeScene: Scene = config.scene;
  let bundleProvider = config.bundleProvider;

  const httpServer: Server = createServer((req, res) => handleHttp(req, res));

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.port ?? 0, host, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("server: failed to bind HTTP");
  }
  const port = address.port;

  const wss = new WebSocketServer({
    server: httpServer,
    path: wsPath,
    handleProtocols: (offered: Set<string>) =>
      offered.has(WS_SUBPROTOCOL) ? WS_SUBPROTOCOL : false,
  });

  const subscribers = new Set<Subscriber>();

  wss.on("connection", (ws) => {
    const sub: Subscriber = { ws, seq: 0, decision: null, unsubscribePatches: null };
    subscribers.add(sub);

    ws.on("message", (data) => handleMessage(sub, String(data)).catch(() => undefined));
    ws.on("close", () => {
      sub.unsubscribePatches?.();
      subscribers.delete(sub);
    });
  });

  async function handleMessage(sub: Subscriber, raw: string): Promise<void> {
    let frame;
    try {
      frame = decodeClientFrame(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : "decode error";
      // LSDP/1 §13: envelope.v mismatch → close with code 1002 directly,
      // no error frame (the v != 1 client wouldn't grok our v: 1 envelope).
      if (message.includes("envelope.v")) {
        sub.ws.close(1002, "VERSION_MISMATCH");
        return;
      }
      const code = err instanceof LumencastError ? err.code : "INVALID_VALUE";
      const recoverable = err instanceof LumencastError ? err.recoverable : false;
      const path = err instanceof LumencastError ? err.path : undefined;
      sendError(sub, code, message, recoverable, path !== undefined ? { path } : undefined);
      // Recoverable decode errors (e.g. forbidden object value in a single
      // patch per §3.2.1) MUST keep the connection open ; only fatal
      // structural errors close.
      if (!recoverable) {
        sub.ws.close(1002, code);
      }
      return;
    }
    if (frame === null) return; // forward-compat ignore

    switch (frame.type) {
      case "subscribe": {
        await handleSubscribe(sub, frame.token);
        return;
      }
      case "input": {
        await handleInput(sub, frame.patches);
        return;
      }
      case "ping": {
        sendFrame(sub, pong());
        return;
      }
    }
  }

  async function handleSubscribe(sub: Subscriber, token: string): Promise<void> {
    let decision: AuthDecision;
    try {
      decision = await authenticate(token);
    } catch (err) {
      const code: ErrorCode =
        err instanceof LumencastError && isProtocolErrorCode(err.code) ? err.code : "AUTH_DENIED";
      sendError(sub, code, err instanceof Error ? err.message : "auth error", false);
      sub.ws.close(1008, code);
      return;
    }
    sub.decision = decision;

    sub.seq = 1;
    sendFrame(
      sub,
      snapshotFrame({
        seq: 1,
        scene_id: activeScene.sceneId,
        scene_version: activeScene.sceneVersion,
        state: activeScene.store.snapshot(),
        ts: new Date().toISOString(),
      }),
    );

    // Wire up delta forwarding from the *current* active scene. If the active
    // scene swaps, this subscriber stays bound to the old one and is detached
    // by setActiveScene().
    sub.unsubscribePatches = activeScene.onPatches((patches) => {
      sub.seq += 1;
      sendFrame(sub, deltaFrame({ seq: sub.seq, patches }));
    });
  }

  async function handleInput(sub: Subscriber, patches: Patch[]): Promise<void> {
    if (!sub.decision) {
      sendError(sub, "AUTH_DENIED", "input before subscribe", false);
      return;
    }
    // 1. Role-based authorization (LSDP/1 §9).
    for (const p of patches) {
      if (!canWritePath(sub.decision, p.path)) {
        sendError(
          sub,
          "WRITE_FORBIDDEN",
          `role ${sub.decision.role} cannot write ${p.path}`,
          true,
          { path: p.path },
        );
        return;
      }
    }
    // 2. Schema validation against operator_inputs (LSDP/1 §4.2 + LSML §8).
    //    Atomic: reject the whole frame on the first violation, no patches applied.
    const validationError = activeScene.validateInput(patches);
    if (validationError) {
      sendError(sub, validationError.code, validationError.message, true, {
        path: validationError.path,
      });
      return;
    }
    activeScene.update(patches);
  }

  function handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? "/";
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET, OPTIONS");
    res.setHeader("access-control-allow-headers", "*");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method === "GET" && url === `${wsPath}/health`) {
      writeJson(res, 200, { status: "ok" });
      return;
    }

    // GET /lsdp/v1/scenes/{id}/bundle?v=sha256:...
    const escaped = bundlePathPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^${escaped}/([^/?]+)/bundle(?:\\?v=([^&]+))?$`);
    const match = url.match(re);
    if (req.method === "GET" && match) {
      const versionParam = match[2] ? decodeURIComponent(match[2]) : activeScene.sceneVersion;
      Promise.resolve(bundleProvider(versionParam))
        .then((bundle) => {
          if (!bundle) {
            writeJson(res, 404, { error: "bundle_not_found" });
            return;
          }
          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.setHeader("cache-control", "public, max-age=31536000, immutable");
          res.end(JSON.stringify(bundle));
        })
        .catch((err) => writeJson(res, 500, { error: String(err) }));
      return;
    }

    writeJson(res, 404, { error: "not_found" });
  }

  function sendFrame(sub: Subscriber, frame: object): void {
    if (sub.ws.readyState !== sub.ws.OPEN) return;
    sub.ws.send(encodeFrame(frame as Parameters<typeof encodeFrame>[0]));
  }

  function sendError(
    sub: Subscriber,
    code: ErrorCode,
    message: string,
    recoverable: boolean,
    extras?: { path?: string; retry_after_ms?: number },
  ): void {
    sub.seq += 1;
    sendFrame(
      sub,
      errorFrame({
        seq: sub.seq,
        code,
        message,
        recoverable,
        ...(extras?.path !== undefined ? { path: extras.path } : {}),
        ...(extras?.retry_after_ms !== undefined ? { retry_after_ms: extras.retry_after_ms } : {}),
      }),
    );
  }

  function detachAllSubscribers(closeCode = 1012, reason = "service restart"): void {
    for (const sub of subscribers) {
      sub.unsubscribePatches?.();
      try {
        sub.ws.close(closeCode, reason);
      } catch {
        // ignore
      }
    }
    subscribers.clear();
  }

  function setActiveScene(scene: Scene): void {
    detachAllSubscribers();
    activeScene = scene;
  }

  function setBundleProvider(fn: (version: SceneVersion) => Promise<unknown> | unknown): void {
    bundleProvider = fn;
  }

  function reset(): void {
    detachAllSubscribers();
  }

  async function close(): Promise<void> {
    detachAllSubscribers(1000, "shutdown");
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }

  return {
    wsUrl: `ws://${host}:${port}${wsPath}`,
    httpUrl: `http://${host}:${port}`,
    setActiveScene,
    setBundleProvider,
    activeScene: () => activeScene,
    reset,
    close,
  };
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
