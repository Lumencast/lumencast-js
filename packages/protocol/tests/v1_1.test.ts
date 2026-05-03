// LSDP/1.1 — additive frame surface round-trip tests.
// Mirrors lumencast-go/protocol/protocol_test.go's 1.1 test suite.

import { describe, expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  WS_SUBPROTOCOL,
  WS_SUBPROTOCOL_V1_1,
  WS_SUBPROTOCOLS,
  decodeClientFrame,
  decodeServerFrame,
  delta,
  encodeFrame,
  input,
  ping,
  pong,
  sceneChanged,
  subscribe,
  unsubscribe,
  type Cause,
  type DeltaFrame,
  type InputFrame,
  type PingFrame,
  type PongFrame,
  type SceneChangedFrame,
  type SubscribeFrame,
  type TransitionSpec,
  type UnsubscribeFrame,
} from "../src/index.js";

describe("subprotocol negotiation", () => {
  it("exposes 1.0 and 1.1 constants", () => {
    expect(WS_SUBPROTOCOL).toBe("lsdp.v1");
    expect(WS_SUBPROTOCOL_V1_1).toBe("lsdp.v1.1");
  });

  it("preference order is 1.1 first, 1.0 fallback", () => {
    expect(WS_SUBPROTOCOLS).toEqual(["lsdp.v1.1", "lsdp.v1"]);
  });
});

describe("Subscribe.since_sequence (LSDP/1.1 §4.1, §18)", () => {
  it("round-trips a positive value", () => {
    const frame = subscribe({ token: "t", since_sequence: 12345 });
    expect(frame.since_sequence).toBe(12345);
    const raw = encodeFrame(frame);
    expect(raw).toBe(`{"v":1,"type":"subscribe","token":"t","since_sequence":12345}`);
    const decoded = decodeClientFrame(raw) as SubscribeFrame;
    expect(decoded.since_sequence).toBe(12345);
  });

  it("omits the field when absent (1.0 wire stability)", () => {
    const frame = subscribe({ token: "t" });
    expect(encodeFrame(frame)).toBe(`{"v":1,"type":"subscribe","token":"t"}`);
  });
});

describe("Input.client_msg_id (LSDP/1.1 §4.2)", () => {
  it("round-trips through the input builder + codec", () => {
    const frame = input([{ path: "x", value: 1 }], { client_msg_id: "ui-9f3a" });
    const raw = encodeFrame(frame);
    expect(raw).toContain(`"client_msg_id":"ui-9f3a"`);
    const decoded = decodeClientFrame(raw) as InputFrame;
    expect(decoded.client_msg_id).toBe("ui-9f3a");
  });

  it("omits the field on bare inputs", () => {
    const frame = input([{ path: "x", value: 1 }]);
    expect(encodeFrame(frame)).toBe(`{"v":1,"type":"input","patches":[{"path":"x","value":1}]}`);
  });
});

describe("Ping/Pong nonce (LSDP/1.1 §4.3, §3.5)", () => {
  it("ping nonce round-trips", () => {
    const raw = encodeFrame(ping("probe-7a2c"));
    expect(raw).toBe(`{"v":1,"type":"ping","nonce":"probe-7a2c"}`);
    const decoded = decodeClientFrame(raw) as PingFrame;
    expect(decoded.nonce).toBe("probe-7a2c");
  });

  it("pong nonce round-trips", () => {
    const raw = encodeFrame(pong("probe-7a2c"));
    expect(raw).toBe(`{"v":1,"type":"pong","nonce":"probe-7a2c"}`);
    const decoded = decodeServerFrame(raw) as PongFrame;
    expect(decoded.nonce).toBe("probe-7a2c");
  });

  it("bare ping/pong omit the nonce field", () => {
    expect(encodeFrame(ping())).toBe(`{"v":1,"type":"ping"}`);
    expect(encodeFrame(pong())).toBe(`{"v":1,"type":"pong"}`);
  });
});

describe("Unsubscribe (LSDP/1.1 §4.4)", () => {
  it("builder + encoder produce the canonical wire shape", () => {
    const frame = unsubscribe();
    expect(frame).toEqual({ v: PROTOCOL_VERSION, type: "unsubscribe" });
    expect(encodeFrame(frame)).toBe(`{"v":1,"type":"unsubscribe"}`);
  });

  it("decoder dispatches the new type", () => {
    const decoded = decodeClientFrame(`{"v":1,"type":"unsubscribe"}`) as UnsubscribeFrame;
    expect(decoded.type).toBe("unsubscribe");
  });
});

describe("Delta with cause + per-leaf transition (§3.2.2 + §3.2.3)", () => {
  it("round-trips both fields", () => {
    const transition: TransitionSpec = {
      kind: "tween",
      duration_ms: 500,
      easing: "ease-out",
    };
    const cause: Cause = { source: "operator:alice", input_id: "ui-9f3a" };
    const frame = delta({
      seq: 7,
      patches: [{ path: "score", value: 42, transition }],
      cause,
    });
    const raw = encodeFrame(frame);
    expect(raw).toContain(`"transition":{"kind":"tween"`);
    expect(raw).toContain(`"cause":{"source":"operator:alice"`);

    const decoded = decodeServerFrame(raw) as DeltaFrame;
    expect(decoded.cause).toEqual(cause);
    expect(decoded.patches[0]?.transition).toEqual(transition);
  });

  it("rejects a transition with an invalid kind", () => {
    const raw = `{"v":1,"type":"delta","seq":1,"patches":[{"path":"x","value":1,"transition":{"kind":"warp"}}]}`;
    expect(() => decodeServerFrame(raw)).toThrow(/transition.+kind/);
  });

  it("rejects a cause without source", () => {
    const raw = `{"v":1,"type":"delta","seq":1,"patches":[{"path":"x","value":1}],"cause":{"input_id":"x"}}`;
    expect(() => decodeServerFrame(raw)).toThrow(/cause\.source/);
  });
});

describe("SceneChanged.from_scene_id + transition (§3.3.1)", () => {
  it("round-trips the show-level transition", () => {
    const frame = sceneChanged({
      seq: 100,
      scene_id: "scene-b",
      scene_version: "sha256:b0",
      from_scene_id: "scene-a",
      transition: { kind: "crossfade", duration_ms: 600 },
    });
    const raw = encodeFrame(frame);
    expect(raw).toContain(`"from_scene_id":"scene-a"`);
    expect(raw).toContain(`"transition":{"kind":"crossfade","duration_ms":600}`);

    const decoded = decodeServerFrame(raw) as SceneChangedFrame;
    expect(decoded.from_scene_id).toBe("scene-a");
    expect(decoded.transition?.kind).toBe("crossfade");
    expect(decoded.transition?.duration_ms).toBe(600);
  });
});

describe("backward-compat — 1.0 callers produce byte-identical wire", () => {
  it("Subscribe without 1.1 fields", () => {
    expect(encodeFrame(subscribe({ token: "t" }))).toBe(`{"v":1,"type":"subscribe","token":"t"}`);
  });

  it("Delta without cause/transition", () => {
    const f = delta({ seq: 1, patches: [{ path: "x", value: 1 }] });
    expect(encodeFrame(f)).toBe(
      `{"v":1,"type":"delta","seq":1,"patches":[{"path":"x","value":1}]}`,
    );
  });

  it("SceneChanged without 1.1 fields", () => {
    const f = sceneChanged({
      seq: 1,
      scene_id: "s",
      scene_version: "sha256:0",
    });
    expect(encodeFrame(f)).toBe(
      `{"v":1,"type":"scene_changed","seq":1,"scene_id":"s","scene_version":"sha256:0"}`,
    );
  });
});

describe("forward-compat — 1.0 receivers tolerate 1.1 fields", () => {
  it("decodes a 1.1 delta cleanly", () => {
    const raw = `{"v":1,"type":"delta","seq":1,"patches":[{"path":"x","value":1}],"cause":{"source":"adapter:http_poll"}}`;
    const f = decodeServerFrame(raw) as DeltaFrame;
    expect(f.seq).toBe(1);
    expect(f.cause?.source).toBe("adapter:http_poll");
  });
});
