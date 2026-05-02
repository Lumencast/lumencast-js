import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { decodeServerFrame, encodeFrame, subscribe, WS_SUBPROTOCOL } from "@lumencast/protocol";
import { startDevServer, type DevServer } from "../src/index.js";

const initialBundle = {
  lsml: "1.0",
  scene_id: "main",
  scene_version: "sha256:0001",
  layout: { kind: "frame" },
};

let server: DevServer;

beforeEach(async () => {
  server = await startDevServer({
    port: 0,
    initialSceneId: "main",
    initialSceneVersion: "sha256:0001",
    initialBundle,
    initialState: { "show.title": "Live", "players.0.score": 0 },
  });
});

afterEach(async () => {
  await server.close();
});

interface Client {
  ws: WebSocket;
  recv(timeoutMs?: number): Promise<string>;
}

function open(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(server.wsUrl, [WS_SUBPROTOCOL]);
    const inbox: string[] = [];
    const waiters: Array<(v: string) => void> = [];
    ws.on("message", (data) => {
      const s = String(data);
      const w = waiters.shift();
      if (w) w(s);
      else inbox.push(s);
    });
    ws.once("open", () =>
      resolve({
        ws,
        recv(timeoutMs = 1000) {
          return new Promise((res, rej) => {
            const queued = inbox.shift();
            if (queued !== undefined) return res(queued);
            const t = setTimeout(() => {
              const i = waiters.indexOf(res);
              if (i >= 0) waiters.splice(i, 1);
              rej(new Error("recv timeout"));
            }, timeoutMs);
            waiters.push((v) => {
              clearTimeout(t);
              res(v);
            });
          });
        },
      }),
    );
    ws.once("error", reject);
  });
}

describe("dev-server — WS lifecycle", () => {
  it("emits a snapshot on subscribe", async () => {
    const c = await open();
    const ws = c.ws;
    ws.send(encodeFrame(subscribe({ token: "anything" })));
    const raw = await c.recv();
    const frame = decodeServerFrame(raw);
    expect(frame).toMatchObject({
      type: "snapshot",
      seq: 1,
      scene_id: "main",
      scene_version: "sha256:0001",
    });
    ws.close();
  });

  it("pushes deltas with monotonically increasing seq", async () => {
    const c = await open();
    const ws = c.ws;
    ws.send(encodeFrame(subscribe({ token: "x" })));
    await c.recv(); // snapshot

    server.pushDelta([{ path: "players.0.score", value: 1 }]);
    const d1 = decodeServerFrame(await c.recv());
    expect(d1).toMatchObject({ type: "delta", seq: 2 });

    server.pushDelta([{ path: "players.0.score", value: 2 }]);
    const d2 = decodeServerFrame(await c.recv());
    expect(d2).toMatchObject({ type: "delta", seq: 3 });

    ws.close();
  });

  it("scene_changed resets seq to 1 on the following snapshot", async () => {
    const c = await open();
    const ws = c.ws;
    ws.send(encodeFrame(subscribe({ token: "x" })));
    await c.recv(); // snapshot

    server.switchScene({
      sceneId: "intermission",
      sceneVersion: "sha256:0002",
      bundle: {
        lsml: "1.0",
        scene_id: "intermission",
        scene_version: "sha256:0002",
        layout: { kind: "frame" },
      },
      state: { "show.title": "Back soon" },
    });

    const sc = decodeServerFrame(await c.recv());
    expect(sc).toMatchObject({ type: "scene_changed", scene_id: "intermission" });

    const snap = decodeServerFrame(await c.recv());
    expect(snap).toMatchObject({ type: "snapshot", seq: 1, scene_id: "intermission" });

    ws.close();
  });
});

describe("dev-server — HTTP", () => {
  it("serves /lsdp/v1/health", async () => {
    const res = await fetch(`${server.httpUrl}/lsdp/v1/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("serves the active bundle by version", async () => {
    const res = await fetch(`${server.httpUrl}/lsdp/v1/scenes/main/bundle?v=sha256:0001`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(initialBundle);
  });

  it("404s on unknown bundle version", async () => {
    const res = await fetch(`${server.httpUrl}/lsdp/v1/scenes/main/bundle?v=sha256:nope`);
    expect(res.status).toBe(404);
  });
});

describe("dev-server — control plane", () => {
  it("/__mock/delta pushes a delta", async () => {
    const c = await open();
    const ws = c.ws;
    ws.send(encodeFrame(subscribe({ token: "x" })));
    await c.recv();

    const res = await fetch(`${server.httpUrl}/__mock/delta`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patches: [{ path: "show.title", value: "Hot Take" }] }),
    });
    expect(res.status).toBe(204);

    const d = decodeServerFrame(await c.recv());
    expect(d).toMatchObject({
      type: "delta",
      patches: [{ path: "show.title", value: "Hot Take" }],
    });
    ws.close();
  });
});
