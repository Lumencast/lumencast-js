// Mock LSDP/1 server for Lumencast SDK tests.
//
// Behaviour parity with a real LSDP/1 server (LSDP/1 spec):
//   - WebSocket subprotocol negotiation: `lsdp.v1`
//   - subscribe → snapshot(seq=1) → delta(seq=2,3,...)
//   - scene_changed(seq=N) → snapshot(seq=1) (sequence reset)
//   - error frame on malformed input (taxonomy-aligned codes)
//
// What it skips: auth (any token accepted), rate limiting, persistence.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  delta as deltaFrame,
  decodeClientFrame,
  encodeFrame,
  errorFrame,
  pong,
  sceneChanged as sceneChangedFrame,
  snapshot as snapshotFrame,
  WS_SUBPROTOCOL,
  type LeafValue,
  type Patch,
  type SceneId,
  type SceneVersion,
} from "@lumencast/protocol";

export interface DevServerConfig {
  /** Listening port (0 = random). */
  port?: number;
  /** Hostname to bind. Defaults to 127.0.0.1. */
  host?: string;
  /** Initial scene id. */
  initialSceneId: SceneId;
  /** Initial scene version (sha256:...). */
  initialSceneVersion: SceneVersion;
  /** LSML bundle for the initial scene (passed through, not validated by the mock). */
  initialBundle: unknown;
  /** Initial state (path → value). */
  initialState: Record<string, LeafValue>;
}

export interface DevServer {
  /** WS URL clients connect to. */
  readonly wsUrl: string;
  /** HTTP base URL (bundle fetch + control plane). */
  readonly httpUrl: string;
  /** Add or replace a bundle by scene_version. */
  registerBundle(sceneVersion: SceneVersion, bundle: unknown): void;
  /** Push a delta to all live subscribers of the active scene. */
  pushDelta(patches: Patch[]): void;
  /** Atomically switch the active scene; emits scene_changed + snapshot to subscribers. */
  switchScene(args: SwitchSceneArgs): void;
  /** Close every connection and stop listening. */
  close(): Promise<void>;
}

export interface SwitchSceneArgs {
  sceneId: SceneId;
  sceneVersion: SceneVersion;
  bundle: unknown;
  state: Record<string, LeafValue>;
}

interface Subscriber {
  ws: WebSocket;
  seq: number;
}

export async function startDevServer(config: DevServerConfig): Promise<DevServer> {
  let activeSceneId: SceneId = config.initialSceneId;
  let activeSceneVersion: SceneVersion = config.initialSceneVersion;
  let activeState: Record<string, LeafValue> = { ...config.initialState };
  const bundles = new Map<SceneVersion, unknown>();
  bundles.set(config.initialSceneVersion, config.initialBundle);

  const subscribers = new Set<Subscriber>();

  const httpServer: Server = createServer((req, res) => handleHttp(req, res));

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.port ?? 0, config.host ?? "127.0.0.1", () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("dev-server: failed to bind HTTP server");
  }
  const host = config.host ?? "127.0.0.1";
  const port = address.port;

  const wss = new WebSocketServer({
    server: httpServer,
    handleProtocols: (offered: Set<string>) => {
      return offered.has(WS_SUBPROTOCOL) ? WS_SUBPROTOCOL : false;
    },
  });

  wss.on("connection", (socket) => {
    const sub: Subscriber = { ws: socket, seq: 0 };
    subscribers.add(sub);

    socket.on("message", (data) => handleMessage(sub, String(data)));
    socket.on("close", () => {
      subscribers.delete(sub);
    });
  });

  function handleMessage(sub: Subscriber, raw: string): void {
    let frame;
    try {
      frame = decodeClientFrame(raw);
    } catch {
      sendError(sub, "INVALID_VALUE", "malformed client frame", false);
      sub.ws.close(1002, "INVALID_VALUE");
      return;
    }
    if (frame === null) return; // unknown frame type — forward-compat ignore

    switch (frame.type) {
      case "subscribe": {
        sub.seq = 1;
        send(
          sub,
          snapshotFrame({
            seq: 1,
            scene_id: activeSceneId,
            scene_version: activeSceneVersion,
            state: { ...activeState },
            ts: new Date().toISOString(),
          }),
        );
        return;
      }
      case "input": {
        // Mock-mode echoes inputs as deltas to all subscribers.
        broadcastDelta(frame.patches);
        return;
      }
      case "ping": {
        send(sub, pong());
        return;
      }
    }
  }

  function broadcastDelta(patches: Patch[]): void {
    for (const p of patches) activeState[p.path] = p.value;
    for (const sub of subscribers) {
      sub.seq += 1;
      send(sub, deltaFrame({ seq: sub.seq, patches }));
    }
  }

  function pushDelta(patches: Patch[]): void {
    broadcastDelta(patches);
  }

  function switchScene(args: SwitchSceneArgs): void {
    activeSceneId = args.sceneId;
    activeSceneVersion = args.sceneVersion;
    activeState = { ...args.state };
    bundles.set(args.sceneVersion, args.bundle);

    for (const sub of subscribers) {
      sub.seq += 1;
      send(
        sub,
        sceneChangedFrame({
          seq: sub.seq,
          scene_id: args.sceneId,
          scene_version: args.sceneVersion,
        }),
      );
      // LSDP/1 §3.3: the next server frame after scene_changed is a snapshot
      // for the new scene with seq = 1.
      sub.seq = 1;
      send(
        sub,
        snapshotFrame({
          seq: 1,
          scene_id: args.sceneId,
          scene_version: args.sceneVersion,
          state: { ...activeState },
          ts: new Date().toISOString(),
        }),
      );
    }
  }

  function registerBundle(version: SceneVersion, bundle: unknown): void {
    bundles.set(version, bundle);
  }

  function send(sub: Subscriber, frame: object): void {
    if (sub.ws.readyState !== sub.ws.OPEN) return;
    sub.ws.send(encodeFrame(frame as Parameters<typeof encodeFrame>[0]));
  }

  function sendError(
    sub: Subscriber,
    code: Parameters<typeof errorFrame>[0]["code"],
    message: string,
    recoverable: boolean,
  ): void {
    sub.seq += 1;
    send(sub, errorFrame({ seq: sub.seq, code, message, recoverable }));
  }

  function handleHttp(req: IncomingMessage, res: ServerResponse): void {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.setHeader("access-control-allow-headers", "*");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = req.url ?? "/";

    if (req.method === "GET" && url === "/lsdp/v1/health") {
      writeJson(res, 200, { status: "ok" });
      return;
    }

    // GET /lsdp/v1/scenes/{id}/bundle?v=sha256:...
    const bundleMatch = url.match(/^\/lsdp\/v1\/scenes\/([^/?]+)\/bundle(?:\?v=([^&]+))?$/);
    if (req.method === "GET" && bundleMatch) {
      const versionParam = bundleMatch[2] ? decodeURIComponent(bundleMatch[2]) : undefined;
      const bundle = versionParam ? bundles.get(versionParam) : bundles.get(activeSceneVersion);
      if (!bundle) {
        writeJson(res, 404, { error: "bundle_not_found" });
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.setHeader("cache-control", "public, max-age=31536000, immutable");
      res.end(JSON.stringify(bundle));
      return;
    }

    if (req.method === "POST" && url === "/__mock/delta") {
      readJson(req)
        .then((body) => {
          const patches = (body as { patches: Patch[] }).patches;
          pushDelta(patches);
          res.statusCode = 204;
          res.end();
        })
        .catch((err) => writeJson(res, 400, { error: String(err) }));
      return;
    }

    if (req.method === "POST" && url === "/__mock/scene-changed") {
      readJson(req)
        .then((body) => {
          switchScene(body as SwitchSceneArgs);
          res.statusCode = 204;
          res.end();
        })
        .catch((err) => writeJson(res, 400, { error: String(err) }));
      return;
    }

    if (req.method === "POST" && url === "/__mock/register-bundle") {
      readJson(req)
        .then((body) => {
          const { sceneVersion, bundle } = body as {
            sceneVersion: SceneVersion;
            bundle: unknown;
          };
          registerBundle(sceneVersion, bundle);
          res.statusCode = 204;
          res.end();
        })
        .catch((err) => writeJson(res, 400, { error: String(err) }));
      return;
    }

    if (req.method === "POST" && url === "/__mock/reset") {
      activeSceneId = config.initialSceneId;
      activeSceneVersion = config.initialSceneVersion;
      activeState = { ...config.initialState };
      bundles.clear();
      bundles.set(config.initialSceneVersion, config.initialBundle);
      res.statusCode = 204;
      res.end();
      return;
    }

    writeJson(res, 404, { error: "not_found" });
  }

  async function close(): Promise<void> {
    for (const sub of subscribers) {
      try {
        sub.ws.close(1000, "shutdown");
      } catch {
        // ignore
      }
    }
    subscribers.clear();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }

  return {
    wsUrl: `ws://${host}:${port}/lsdp/v1`,
    httpUrl: `http://${host}:${port}`,
    registerBundle,
    pushDelta,
    switchScene,
    close,
  };
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body.length === 0 ? {} : JSON.parse(body);
}
