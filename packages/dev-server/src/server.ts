// Mock LSDP/1 server for Lumencast SDK tests.
//
// Behaviour parity with a real LSDP/1 server (LSDP/1 spec):
//   - WebSocket subprotocol negotiation: `lsdp.v1`
//   - subscribe → snapshot(seq=1) → delta(seq=2,3,...)
//   - scene_changed(seq=N) → snapshot(seq=1) (sequence reset)
//   - error frame on malformed input (taxonomy-aligned codes)
//
// What it skips: auth (any token accepted), rate limiting, persistence.

import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
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
  WS_SUBPROTOCOL_V1_1,
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
  /**
   * Optional in-process demo host. When set, the dev-server serves a
   * static HTML page at `GET /` that mounts the runtime against this
   * very server. Use for local end-to-end demos: open the printed
   * httpUrl in a browser to see the scene render live.
   *
   * `runtimeBundlePath` is the absolute path to the prebuilt runtime
   * (`@lumencast/runtime/dist/lumencast.js`). Defaults to a workspace
   * resolution lookup ; pass an explicit path to override.
   */
  demoHost?: {
    runtimeBundlePath?: string;
    /** Optional title shown in the browser tab. Defaults to "Lumencast demo". */
    title?: string;
  };
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
      // LSDP/1.1 preferred, 1.0 fallback.
      if (offered.has(WS_SUBPROTOCOL_V1_1)) return WS_SUBPROTOCOL_V1_1;
      if (offered.has(WS_SUBPROTOCOL)) return WS_SUBPROTOCOL;
      return false;
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

    // Demo host (optional) — serves a static HTML at `/` and the
    // runtime bundle at `/lumencast.js` so a developer can open the
    // server URL in a browser and see the scene render live without
    // any external Vite/build step.
    if (config.demoHost && req.method === "GET" && (url === "/" || url === "/index.html")) {
      const wsUrl = `ws://${host}:${port}/lsdp/v1`;
      const title = config.demoHost.title ?? "Lumencast demo";
      const html = renderDemoHostHtml({ wsUrl, title });
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(html);
      return;
    }
    if (config.demoHost && req.method === "GET" && isStaticAssetPath(url)) {
      const bundlePath = resolveRuntimeBundlePath(config.demoHost.runtimeBundlePath);
      if (!bundlePath) {
        writeJson(res, 500, {
          error: "runtime_bundle_not_found",
          hint: "pnpm --filter @lumencast/runtime build (or pass demoHost.runtimeBundlePath)",
        });
        return;
      }
      // The runtime bundle is split into chunks. Serve any file under
      // its dist/ tree by name, sandboxed to that directory.
      const distDir = dirname(bundlePath);
      const requested = url.split("?")[0]!.replace(/^\//, "");
      const filePath = resolvePath(distDir, requested);
      // Sandbox check : file must live under distDir.
      if (!filePath.startsWith(distDir)) {
        writeJson(res, 400, { error: "path_traversal" });
        return;
      }
      if (!existsSync(filePath)) {
        writeJson(res, 404, { error: "static_not_found", path: requested });
        return;
      }
      try {
        const body = readFileSync(filePath);
        res.statusCode = 200;
        res.setHeader("content-type", contentTypeFor(requested));
        res.setHeader("cache-control", "no-store");
        res.end(body);
      } catch (e) {
        writeJson(res, 500, { error: "static_read_failed", detail: String(e) });
      }
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

/**
 * Resolve the on-disk path of `@lumencast/runtime`'s built bundle.
 * Walks up from this file's directory looking for the workspace's
 * `packages/runtime/dist/lumencast.js`. Returns the override when
 * provided.
 */
/** Heuristic : a static asset request looks like `/something.ext`
 * (single segment, with extension), and isn't an LSDP API path or a
 * mock control plane path. The dev-server's other GET routes are
 * matched before this one, so this only fires when nothing else
 * caught the URL. */
function isStaticAssetPath(url: string): boolean {
  const path = url.split("?")[0] ?? "/";
  if (path === "/" || path === "/index.html") return false; // handled above
  if (path.startsWith("/lsdp/") || path.startsWith("/__mock/")) return false;
  return /\.[a-zA-Z0-9]{1,8}$/.test(path);
}

function contentTypeFor(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".js") || lower.endsWith(".mjs"))
    return "application/javascript; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".html")) return "text/html; charset=utf-8";
  if (lower.endsWith(".json") || lower.endsWith(".map")) return "application/json; charset=utf-8";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}

function resolveRuntimeBundlePath(override?: string): string | null {
  if (override) {
    return existsSync(override) ? override : null;
  }
  // Best-effort workspace lookup. dev-server lives at
  // packages/dev-server/src/server.ts ; the runtime bundle lives at
  // packages/runtime/dist/lumencast.js relative to the same workspace
  // root.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolvePath(here, "../../runtime/dist/lumencast.js"),
    resolvePath(here, "../../../runtime/dist/lumencast.js"),
    resolvePath(process.cwd(), "node_modules/@lumencast/runtime/dist/lumencast.js"),
    resolvePath(process.cwd(), "packages/runtime/dist/lumencast.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/** Render the static demo HTML host. The page mounts the runtime
 * against the same dev-server's WS endpoint and watches the scene
 * update live.
 *
 * The runtime is built as ES modules with externalised peer deps
 * (react, framer-motion, @preact/signals-react, etc). The demo HTML
 * uses an importmap to resolve those bare specifiers to esm.sh CDN
 * URLs so the browser can load everything without a bundler.
 *
 * @lumencast/protocol is also externalised — we map it back to the
 * runtime's own dist relative path because it travels with the bundle.
 */
function renderDemoHostHtml(opts: { wsUrl: string; title: string }): string {
  const importMap = {
    imports: {
      react: "https://esm.sh/react@19?dev",
      "react/jsx-runtime": "https://esm.sh/react@19/jsx-runtime?dev",
      "react/jsx-dev-runtime": "https://esm.sh/react@19/jsx-dev-runtime?dev",
      "react-dom": "https://esm.sh/react-dom@19?dev",
      "react-dom/client": "https://esm.sh/react-dom@19/client?dev",
      "framer-motion": "https://esm.sh/framer-motion@12?dev&deps=react@19,react-dom@19",
      "@preact/signals-react":
        "https://esm.sh/@preact/signals-react@3?dev&deps=react@19,react-dom@19",
      "@preact/signals-react/runtime":
        "https://esm.sh/@preact/signals-react@3/runtime?dev&deps=react@19,react-dom@19",
      "@lumencast/protocol": "https://esm.sh/@lumencast/protocol",
    },
  };
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(opts.title)}</title>
    <style>
      html, body { margin: 0; padding: 0; height: 100%; background: #000; color: #fff; font-family: system-ui, sans-serif; }
      #scene { position: relative; width: 100vw; height: 100vh; overflow: hidden; }
      #lumencast-error { position: fixed; bottom: 0; left: 0; right: 0; padding: 12px; background: #b00020; font-family: monospace; font-size: 12px; display: none; white-space: pre-wrap; }
      #lumencast-status { position: fixed; top: 8px; right: 8px; padding: 4px 8px; font-family: monospace; font-size: 11px; background: rgba(0,0,0,0.5); border-radius: 4px; opacity: 0.7; }
    </style>
    <script type="importmap">${JSON.stringify(importMap)}</script>
  </head>
  <body>
    <div id="scene" data-testid="lumencast-scene-root"></div>
    <div id="lumencast-status">connecting…</div>
    <div id="lumencast-error"></div>
    <script type="module">
      import { mount } from "/lumencast.js";

      const target = document.getElementById("scene");
      const status = document.getElementById("lumencast-status");
      const errBox = document.getElementById("lumencast-error");

      mount({
        target,
        serverUrl: ${JSON.stringify(opts.wsUrl)},
        token: "demo",
        mode: "broadcast",
        onStatus: (s) => { status.textContent = s; },
        onError: (err) => {
          errBox.style.display = "block";
          errBox.textContent = "[lumencast] " + (err && err.message ? err.message : String(err));
          console.error("[lumencast]", err);
        },
      });
    </script>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
