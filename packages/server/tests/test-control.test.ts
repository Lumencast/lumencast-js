// Unit tests for the LSDP/1 interop test control plane.
// Spec: lumencast-protocol/interop/CONTROL.md

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createScene,
  StaticTokens,
  startServer,
  startTestControl,
  type ServerHandle,
  type TestControlHandle,
} from "../src/index.js";

let server: ServerHandle;
let control: TestControlHandle;
let auth: StaticTokens;

beforeEach(async () => {
  auth = new StaticTokens();
  server = await startServer({
    port: 0,
    scene: createScene({
      sceneId: "__initial__",
      sceneVersion: "sha256:" + "0".repeat(64),
      initialState: {},
    }),
    bundleProvider: () => undefined,
    authenticate: auth.authenticate,
  });
  control = await startTestControl({ port: 0, server, auth });
});

afterEach(async () => {
  await control.close();
  await server.close();
});

const VALID_HASH = "sha256:" + "f".repeat(64);

describe("/test/health", () => {
  it("returns control_plane_version 1 + server name", async () => {
    const res = await fetch(`${control.url}/test/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      status: "ok",
      control_plane_version: 1,
      server: "lumencast-js",
    });
  });

  it("405 on POST", async () => {
    const res = await fetch(`${control.url}/test/health`, { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("content-type")).toMatch(/problem\+json/);
  });
});

describe("/test/setup", () => {
  it("registers a scene + tokens, returns ws_url + scene_id + scene_version", async () => {
    const res = await fetch(`${control.url}/test/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scenario: "demo",
        tokens: {
          $TOKEN_OPERATOR: "tok-op",
          $TOKEN_VIEWER: "tok-vw",
        },
        bundles: [
          {
            id: "scene-a",
            hash: VALID_HASH,
            inline: { lsml: "1.0", scene_id: "scene-a", layout: { kind: "frame" } },
          },
        ],
        initial_state: { title: "Hello", count: 0 },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ws_url: string; scene_id: string; scene_version: string };
    expect(body.ws_url).toBe(server.wsUrl);
    expect(body.scene_id).toBe("scene-a");
    expect(body.scene_version).toBe(VALID_HASH);

    // Tokens are installed: operator is recognized, $TOKEN_INVALID is not.
    expect(auth.size()).toBe(2);
  });

  it("never installs $TOKEN_INVALID even if supplied", async () => {
    await fetch(`${control.url}/test/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tokens: {
          $TOKEN_OPERATOR: "tok-op",
          $TOKEN_INVALID: "should-be-ignored",
        },
        bundles: [{ id: "x", hash: VALID_HASH, inline: {} }],
      }),
    });
    expect(auth.size()).toBe(1); // only operator
  });

  it("400 when bundles[] is empty", async () => {
    const res = await fetch(`${control.url}/test/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bundles: [] }),
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toMatch(/problem\+json/);
  });
});

describe("/test/reset", () => {
  it("clears tokens + scene state, returns 204", async () => {
    await fetch(`${control.url}/test/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tokens: { $TOKEN_OPERATOR: "tok" },
        bundles: [{ id: "x", hash: VALID_HASH, inline: {} }],
      }),
    });
    expect(auth.size()).toBe(1);

    const res = await fetch(`${control.url}/test/reset`, { method: "POST" });
    expect(res.status).toBe(204);
    expect(auth.size()).toBe(0);
  });
});

describe("/test/state", () => {
  it("returns scene_id + scene_version + state of the active scene", async () => {
    await fetch(`${control.url}/test/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tokens: {},
        bundles: [{ id: "main", hash: VALID_HASH, inline: {} }],
        initial_state: { title: "Live", count: 7 },
      }),
    });
    const res = await fetch(`${control.url}/test/state`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      scene_id: string;
      scene_version: string;
      state: Record<string, unknown>;
    };
    expect(body.scene_id).toBe("main");
    expect(body.scene_version).toBe(VALID_HASH);
    expect(body.state).toEqual({ title: "Live", count: 7 });
  });
});

describe("/test/emit", () => {
  it("applies patches to the active scene; /test/state reflects them", async () => {
    await fetch(`${control.url}/test/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tokens: {},
        bundles: [{ id: "x", hash: VALID_HASH, inline: {} }],
        initial_state: { count: 0 },
      }),
    });
    const emit = await fetch(`${control.url}/test/emit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patches: [{ path: "count", value: 42 }] }),
    });
    expect(emit.status).toBe(204);

    const state = await fetch(`${control.url}/test/state`).then((r) => r.json());
    expect((state as { state: Record<string, unknown> }).state["count"]).toBe(42);
  });

  it("400 on empty patches[]", async () => {
    await fetch(`${control.url}/test/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tokens: {},
        bundles: [{ id: "x", hash: VALID_HASH, inline: {} }],
      }),
    });
    const res = await fetch(`${control.url}/test/emit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patches: [] }),
    });
    expect(res.status).toBe(400);
  });
});

describe("404 on unknown paths", () => {
  it("returns problem+json", async () => {
    const res = await fetch(`${control.url}/nope`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/problem\+json/);
  });
});
