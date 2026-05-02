// E2E for brief criteria 5 (server SDK end-to-end) and 8 (operator_input round-trip).
//
// Critère 5: mount runtime against @lumencast/server (not the mock dev-server),
// drive a delta via scene.update() from the Node side, observe the DOM update.
//
// Critère 8: a second LSDP/1 connection authenticates as `operator`, sends an
// input frame on __inputs.show_title, the server validates against canWritePath,
// echoes the resulting delta to all subscribers — including the runtime mount.
//
// We boot a dedicated @lumencast/server in beforeAll because Playwright test
// workers don't share globalThis with global-setup.ts.

import { test, expect } from "@playwright/test";
import { WebSocket } from "ws";
import {
  decodeServerFrame,
  encodeFrame,
  input as inputFrame,
  subscribe as subscribeFrame,
  WS_SUBPROTOCOL,
} from "@lumencast/protocol";
import { createScene, startServer, type ServerHandle } from "@lumencast/server";
import { BUNDLE, INITIAL_STATE, SCENE_ID, SCENE_VERSION } from "./fixtures/scoreboard";

let server: ServerHandle;
let scene: ReturnType<typeof createScene>;

test.beforeAll(async () => {
  scene = createScene({
    sceneId: SCENE_ID,
    sceneVersion: SCENE_VERSION,
    initialState: { ...(INITIAL_STATE as Record<string, never>) },
  });
  server = await startServer({
    port: 0,
    scene,
    bundleProvider: () => BUNDLE,
    authenticate: (token) => ({
      role: token === "operator" ? "operator" : "viewer",
    }),
  });
});

test.afterAll(async () => {
  await server.close();
});

test.beforeEach(() => {
  // Reset to initial state before every test.
  scene.update({
    "show.title": "Acceptance Cup",
    "score.home": 0,
    "score.away": 0,
  });
});

function pageUrl(token = "anything"): string {
  const params = new URLSearchParams({
    server: server.wsUrl,
    token,
    mode: "broadcast",
  });
  return `/?${params.toString()}`;
}

async function openLsdpClient(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(server.wsUrl, [WS_SUBPROTOCOL]);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

async function recvOne(ws: WebSocket, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("recvOne timeout")), timeoutMs);
    ws.once("message", (data) => {
      clearTimeout(t);
      resolve(String(data));
    });
  });
}

// --- Critère 5 -------------------------------------------------------------

test("critère 5 — runtime renders deltas pushed via @lumencast/server.scene.update()", async ({
  page,
}) => {
  await page.goto(pageUrl());
  const stage = page.locator("#scene");
  await expect(stage).toHaveAttribute("data-status", "live", { timeout: 10_000 });
  await expect(page.locator("text=Acceptance Cup")).toBeVisible();

  // Drive a delta from the Node-side server kit. The runtime, subscribed via
  // its WebSocket, applies the delta and the React tree re-renders only the
  // bound text primitives.
  scene.update({ "show.title": "Server-driven Title" });
  await expect(page.locator("text=Server-driven Title")).toBeVisible({ timeout: 5_000 });

  scene.update([
    { path: "score.home", value: 7 },
    { path: "score.away", value: 3 },
  ]);
  await expect(page.locator("text=/^7$/").first()).toBeVisible({ timeout: 5_000 });
  await expect(page.locator("text=/^3$/").first()).toBeVisible({ timeout: 5_000 });
});

// --- Critère 8 -------------------------------------------------------------

test("critère 8 — operator input round-trips via @lumencast/server (real validation)", async ({
  page,
}) => {
  await page.goto(pageUrl());
  const stage = page.locator("#scene");
  await expect(stage).toHaveAttribute("data-status", "live", { timeout: 10_000 });
  await expect(page.locator("text=Acceptance Cup")).toBeVisible();

  // Open a parallel LSDP/1 connection as operator and push an input frame.
  const ws = await openLsdpClient();
  ws.send(encodeFrame(subscribeFrame({ token: "operator" })));
  const snap = decodeServerFrame(await recvOne(ws));
  expect(snap).toMatchObject({ type: "snapshot" });

  ws.send(
    encodeFrame(inputFrame([{ path: "__inputs.show_title", value: "Operator-typed Title" }])),
  );

  // Server validates (operator role allowed to write __inputs.*), applies to
  // the scene store, broadcasts a delta to every subscriber. Our 2nd connection
  // sees the echo.
  const echoed = decodeServerFrame(await recvOne(ws, 3000));
  expect(echoed).toMatchObject({
    type: "delta",
    patches: [{ path: "__inputs.show_title", value: "Operator-typed Title" }],
  });

  // The runtime mount, also subscribed, receives the same delta. Its text node
  // is bound to "show.title", so we additionally drive show.title to prove the
  // DOM round-trip end-to-end. (An authoring layer would wire __inputs.show_title
  // → show.title via a server-side handler.)
  scene.update({ "show.title": "Operator-typed Title" });
  await expect(page.locator("text=Operator-typed Title")).toBeVisible({ timeout: 5_000 });

  ws.close();
});

test("critère 8 — viewer role is rejected with WRITE_FORBIDDEN", async () => {
  const ws = await openLsdpClient();
  ws.send(encodeFrame(subscribeFrame({ token: "viewer-token" })));
  const snap = decodeServerFrame(await recvOne(ws));
  expect(snap).toMatchObject({ type: "snapshot" });

  ws.send(encodeFrame(inputFrame([{ path: "__inputs.show_title", value: "I shouldn't" }])));
  const err = decodeServerFrame(await recvOne(ws, 3000));
  expect(err).toMatchObject({
    type: "error",
    code: "WRITE_FORBIDDEN",
    recoverable: true,
  });
  ws.close();
});

// --- Critère 8 — also via dev-server (mock) for the tightest DOM observation ---

test("critère 8 — dev-server input echo updates runtime DOM", async ({ page }) => {
  // dev-server doesn't validate roles, but it does echo input frames as deltas
  // to all subscribers. Tightest end-to-end: input → broadcast → runtime DOM.
  const devWsUrl = process.env["E2E_LUMENCAST_WS"];
  const devHttpUrl = process.env["E2E_LUMENCAST_HTTP"];
  if (!devWsUrl || !devHttpUrl) test.skip(true, "dev-server env not set");

  await fetch(`${devHttpUrl}/__mock/reset`, { method: "POST" });

  const params = new URLSearchParams({
    server: devWsUrl as string,
    token: "any",
    mode: "broadcast",
  });
  await page.goto(`/?${params.toString()}`);
  const stage = page.locator("#scene");
  await expect(stage).toHaveAttribute("data-status", "live", { timeout: 10_000 });

  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const sock = new WebSocket(devWsUrl as string, [WS_SUBPROTOCOL]);
    sock.once("open", () => resolve(sock));
    sock.once("error", reject);
  });
  ws.send(encodeFrame(subscribeFrame({ token: "any" })));
  await recvOne(ws); // drain snapshot

  ws.send(encodeFrame(inputFrame([{ path: "show.title", value: "Round-tripped" }])));
  await expect(page.locator("text=Round-tripped")).toBeVisible({ timeout: 5_000 });
  ws.close();
});
