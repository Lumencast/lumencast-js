// A scene whose backing bundle failed validation serves its rejection to
// every subscriber instead of a snapshot (RFC-0001 A2 §A2.4).
// Conformance: bundle-x-zab-capture-bare-device-id-rejected,
//              bundle-x-zab-capture-media-file-no-size-rejected.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { WS_SUBPROTOCOL_V1_1 } from "@lumencast/protocol";
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

const HASH = "sha256:" + "c".repeat(64);

/** POST /test/setup with a single inline bundle whose layout holds `child`. */
async function setup(child: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${control.url}/test/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tokens: { $TOKEN_OPERATOR: "op-token" },
      bundles: [
        {
          id: "b",
          hash: HASH,
          inline: {
            lsml: "1.1",
            scene_id: "capture-scene",
            scene_version: HASH,
            layout: { kind: "frame", size: { w: 1920, h: 1080 }, children: [child] },
          },
        },
      ],
    }),
  });
  expect(res.status).toBe(200);
}

/** Subscribe with the operator token and resolve the first server frame. */
async function firstFrame(): Promise<Record<string, unknown>> {
  const ws = new WebSocket(server.wsUrl, WS_SUBPROTOCOL_V1_1);
  try {
    return await new Promise((resolve, reject) => {
      ws.on("error", reject);
      ws.on("open", () => ws.send(JSON.stringify({ v: 1, type: "subscribe", token: "op-token" })));
      ws.on("message", (data) => resolve(JSON.parse(String(data))));
      ws.on("close", () => reject(new Error("closed before any frame")));
    });
  } finally {
    ws.close();
  }
}

describe("rejected bundle", () => {
  it("serves INVALID_VALUE instead of a snapshot when deviceRef is a physical id", async () => {
    await setup({
      kind: "x-zab.capture",
      id: "cam",
      "x-zab.sourceKind": "media.webcam",
      "x-zab.deviceRef": "video:0",
      size: { w: 640, h: 360 },
    });
    const frame = await firstFrame();
    expect(frame["type"]).toBe("error");
    expect(frame["code"]).toBe("INVALID_VALUE");
    expect(frame["recoverable"]).toBe(false);
    expect(frame["seq"]).toBe(1);
  });

  it("serves INVALID_VALUE for a media.file with no size (§A2.4 trap)", async () => {
    await setup({
      kind: "x-zab.capture",
      id: "intro",
      "x-zab.sourceKind": "media.file",
      "x-zab.deviceRef": "intro-sting",
    });
    const frame = await firstFrame();
    expect(frame["type"]).toBe("error");
    expect(frame["code"]).toBe("INVALID_VALUE");
  });

  it("the seam is inert on a well-formed bundle — snapshot as usual", async () => {
    await setup({
      kind: "x-zab.capture",
      id: "intro",
      "x-zab.sourceKind": "media.file",
      "x-zab.deviceRef": "intro-sting",
      size: { w: 1920, h: 1080 },
    });
    const frame = await firstFrame();
    expect(frame["type"]).toBe("snapshot");
    expect(frame["scene_id"]).toBe("capture-scene");
  });
});
