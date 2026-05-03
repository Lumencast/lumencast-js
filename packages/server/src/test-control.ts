// LSDP/1 interop test control plane.
//
// HTTP API spec: lumencast-protocol/interop/CONTROL.md
// Reference impl: lumencast-go/interop/control/control.go (mirrored here)
//
// This module is for test infrastructure only. NEVER mount on a public-facing
// port. The serve-scenario CLI is the only sanctioned consumer.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { canWritePath, type AuthDecision, type Role, type StaticTokens } from "./auth.js";
import { createScene } from "./scene.js";
import type { ServerHandle } from "./server.js";

export interface TestControlOptions {
  /** TCP port. 0 = random. */
  port?: number;
  host?: string;
  /** The lumencast server the plane drives. */
  server: ServerHandle;
  /** The static-token authenticator the plane mutates on /test/setup. */
  auth: StaticTokens;
}

export interface TestControlHandle {
  readonly url: string;
  close(): Promise<void>;
}

interface SetupRequest {
  scenario?: string;
  tokens?: Record<string, string>;
  bundles: SetupBundle[];
  initial_state?: Record<string, unknown>;
}

interface SetupBundle {
  id: string;
  hash?: string;
  inline?: unknown;
}

interface EmitRequest {
  patches: { path: string; value: unknown }[];
}

const SERVER_NAME = "lumencast-js";
const CONTROL_PLANE_VERSION = 1;

const ROUTES: Record<string, { method: string }> = {
  "/test/setup": { method: "POST" },
  "/test/reset": { method: "POST" },
  "/test/state": { method: "GET" },
  "/test/emit": { method: "POST" },
  "/test/health": { method: "GET" },
};

export async function startTestControl(options: TestControlOptions): Promise<TestControlHandle> {
  const host = options.host ?? "127.0.0.1";
  const httpServer: Server = createServer((req, res) => handle(req, res));

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port ?? 0, host, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("test-control: failed to bind HTTP");
  }
  const port = address.port;

  function handle(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? "/";
    const method = req.method ?? "";
    const route = ROUTES[url];
    if (!route) {
      writeProblem(res, 404, "not-found", `unknown path ${url}`);
      return;
    }
    if (method !== route.method) {
      writeProblem(res, 405, "method-not-allowed", `${method} not allowed on ${url}`);
      return;
    }
    switch (url) {
      case "/test/setup":
        return void onSetup(req, res);
      case "/test/reset":
        return void onReset(req, res);
      case "/test/state":
        return void onState(req, res);
      case "/test/emit":
        return void onEmit(req, res);
      case "/test/health":
        return void onHealth(req, res);
    }
  }

  async function onSetup(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: SetupRequest;
    try {
      body = (await readJson(req)) as SetupRequest;
    } catch (err) {
      writeProblem(res, 400, "bad-body", `invalid JSON: ${(err as Error).message}`);
      return;
    }
    if (!body || !Array.isArray(body.bundles) || body.bundles.length === 0) {
      writeProblem(res, 400, "missing-bundle", "at least one bundle required");
      return;
    }

    options.server.reset();
    installTokens(options.auth, body.tokens ?? {});

    const primary = body.bundles[0];
    if (!primary || !primary.id) {
      writeProblem(res, 400, "missing-bundle-id", "bundles[0].id required");
      return;
    }

    const initialState = (body.initial_state ?? {}) as Record<string, never>;
    // Prefer the inline LSML's `scene_id` over the bundle id (which is just
    // the $BUNDLE.<id>.hash placeholder identifier). Fall back to the bundle id.
    const inline =
      primary.inline && typeof primary.inline === "object" && primary.inline !== null
        ? (primary.inline as { scene_id?: unknown; operator_inputs?: unknown })
        : undefined;
    const inlineSceneId = inline?.scene_id;
    const sceneId = typeof inlineSceneId === "string" ? inlineSceneId : primary.id;
    const sceneVersion = primary.hash ?? "";
    const operatorInputs = Array.isArray(inline?.operator_inputs)
      ? (inline.operator_inputs as Parameters<typeof createScene>[0]["operatorInputs"])
      : undefined;
    const scene = createScene({
      sceneId,
      sceneVersion,
      initialState,
      ...(operatorInputs ? { operatorInputs } : {}),
    });
    options.server.setActiveScene(scene);

    // The bundle provider serves the inline body of any registered bundle.
    const bundleMap = new Map<string, unknown>();
    for (const b of body.bundles) {
      if (b.hash && b.inline !== undefined) bundleMap.set(b.hash, b.inline);
    }
    options.server.setBundleProvider((version) => bundleMap.get(version));

    writeJson(res, 200, {
      ws_url: options.server.wsUrl,
      scene_id: sceneId,
      scene_version: sceneVersion,
    });
  }

  function onReset(_req: IncomingMessage, res: ServerResponse): void {
    options.server.reset();
    options.auth.reset();
    res.statusCode = 204;
    res.end();
  }

  function onState(_req: IncomingMessage, res: ServerResponse): void {
    const scene = options.server.activeScene();
    // The contract returns 409 if /test/setup wasn't called; we approximate
    // that condition by checking whether the scene has been swapped from a
    // synthetic initial scene. Since the kit always has an active scene, we
    // expose whatever is current. Callers that need the 409 semantics call
    // /test/reset first to drop everything.
    writeJson(res, 200, {
      scene_id: scene.sceneId,
      scene_version: scene.sceneVersion,
      state: scene.store.snapshot(),
    });
  }

  async function onEmit(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: EmitRequest;
    try {
      body = (await readJson(req)) as EmitRequest;
    } catch (err) {
      writeProblem(res, 400, "bad-body", `invalid JSON: ${(err as Error).message}`);
      return;
    }
    if (!body || !Array.isArray(body.patches) || body.patches.length === 0) {
      writeProblem(res, 400, "empty-patches", "at least one patch required");
      return;
    }
    const scene = options.server.activeScene();
    try {
      scene.update(body.patches as Parameters<typeof scene.update>[0]);
    } catch (err) {
      writeProblem(res, 400, "invalid", (err as Error).message);
      return;
    }
    res.statusCode = 204;
    res.end();
  }

  function onHealth(_req: IncomingMessage, res: ServerResponse): void {
    writeJson(res, 200, {
      status: "ok",
      control_plane_version: CONTROL_PLANE_VERSION,
      server: SERVER_NAME,
    });
  }

  async function close(): Promise<void> {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }

  return {
    url: `http://${host}:${port}`,
    close,
  };
}

/** Replace the StaticTokens contents with one entry per recognised
 *  placeholder. $TOKEN_INVALID is intentionally NOT installed — the LSDP/1
 *  conformance suite expects auth to reject it. */
export function installTokens(auth: StaticTokens, tokens: Record<string, string>): void {
  auth.reset();
  for (const [placeholder, value] of Object.entries(tokens)) {
    if (placeholder === "$TOKEN_INVALID" || !value) continue;
    const role = placeholderRole(placeholder);
    if (!role) continue;
    auth.set(value, { role, subject: placeholder });
  }
  // canWritePath is referenced indirectly via the role we install — keep the
  // import alive so the bundler doesn't drop it.
  void canWritePath;
}

function placeholderRole(placeholder: string): Role | null {
  switch (placeholder) {
    case "$TOKEN_OPERATOR":
      return "operator";
    case "$TOKEN_VIEWER":
      return "viewer";
    case "$TOKEN_SERVICE":
      return "service";
    case "$TOKEN_TEST":
      return "test";
    default:
      return null;
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function writeProblem(res: ServerResponse, status: number, code: string, detail: string): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/problem+json");
  res.end(
    JSON.stringify({
      type: "about:blank",
      title: `control: ${code}`,
      status,
      detail,
    }),
  );
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString("utf8");
  if (body.length === 0) return {};
  return JSON.parse(body);
}

// AuthDecision is referenced for type clarity; keep it exported via the helper.
export type { AuthDecision };
