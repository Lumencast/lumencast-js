import { describe, expect, it } from "vitest";
import {
  decodeClientFrame,
  decodeServerFrame,
  delta,
  encodeFrame,
  errorFrame,
  input,
  LumencastError,
  pong,
  ping,
  snapshot,
  sceneChanged,
  subscribe,
  PROTOCOL_VERSION,
} from "../src/index.js";

describe("codec — server frames round-trip", () => {
  it("encodes & decodes a snapshot", () => {
    const frame = snapshot({
      seq: 1,
      scene_id: "main-stage",
      scene_version: "sha256:abc",
      state: { "show.title": "Live", "players.0.score": 0 },
      ts: "2026-05-03T12:00:00Z",
    });
    const round = decodeServerFrame(encodeFrame(frame));
    expect(round).toEqual(frame);
  });

  it("encodes & decodes a delta with mixed leaf values", () => {
    const frame = delta({
      seq: 2,
      patches: [
        { path: "show.title", value: "Match Point" },
        { path: "show.visible", value: true },
        { path: "show.tags", value: ["live", "esport"] },
        { path: "show.subtitle", value: null },
      ],
    });
    const round = decodeServerFrame(encodeFrame(frame));
    expect(round).toEqual(frame);
  });

  it("encodes & decodes a scene_changed", () => {
    const frame = sceneChanged({
      seq: 100,
      scene_id: "intermission",
      scene_version: "sha256:def",
    });
    const round = decodeServerFrame(encodeFrame(frame));
    expect(round).toEqual(frame);
  });

  it("encodes & decodes an error with optional retry_after_ms", () => {
    const frame = errorFrame({
      seq: 50,
      code: "RATE_LIMIT",
      message: "too many inputs",
      recoverable: true,
      retry_after_ms: 250,
    });
    const round = decodeServerFrame(encodeFrame(frame));
    expect(round).toEqual(frame);
  });

  it("encodes & decodes a pong", () => {
    const round = decodeServerFrame(encodeFrame(pong()));
    expect(round).toEqual({ v: PROTOCOL_VERSION, type: "pong" });
  });

  it("returns null for unknown server frame type (forward-compat)", () => {
    const raw = JSON.stringify({ v: 1, type: "future_frame", seq: 1 });
    expect(decodeServerFrame(raw)).toBeNull();
  });
});

describe("codec — client frames round-trip", () => {
  it("encodes & decodes a subscribe with token only", () => {
    const frame = subscribe({ token: "abc" });
    const round = decodeClientFrame(encodeFrame(frame));
    expect(round).toEqual(frame);
  });

  it("encodes & decodes a subscribe with scene + session", () => {
    const frame = subscribe({ token: "abc", scene: "preview", session: "s-1" });
    const round = decodeClientFrame(encodeFrame(frame));
    expect(round).toEqual(frame);
  });

  it("encodes & decodes an input", () => {
    const frame = input([{ path: "__inputs.show_title", value: "Hello" }]);
    const round = decodeClientFrame(encodeFrame(frame));
    expect(round).toEqual(frame);
  });

  it("encodes & decodes a ping", () => {
    const round = decodeClientFrame(encodeFrame(ping()));
    expect(round).toEqual({ v: PROTOCOL_VERSION, type: "ping" });
  });

  it("returns null for unknown client frame type", () => {
    const raw = JSON.stringify({ v: 1, type: "future_action" });
    expect(decodeClientFrame(raw)).toBeNull();
  });
});

describe("codec — envelope rejection", () => {
  it("rejects non-JSON", () => {
    expect(() => decodeServerFrame("not json")).toThrow(LumencastError);
  });

  it("rejects non-object", () => {
    expect(() => decodeServerFrame("[]")).toThrow(/JSON object/);
  });

  it("rejects v != 1", () => {
    const raw = JSON.stringify({ v: 2, type: "snapshot" });
    expect(() => decodeServerFrame(raw)).toThrow(/envelope.v/);
  });

  it("rejects missing required fields", () => {
    const raw = JSON.stringify({ v: 1, type: "snapshot", seq: 1 });
    expect(() => decodeServerFrame(raw)).toThrow(/missing required field/);
  });

  it("rejects nested-object patch values (objects forbidden in patches)", () => {
    const raw = JSON.stringify({
      v: 1,
      type: "delta",
      seq: 2,
      patches: [{ path: "x", value: { nested: 1 } }],
    });
    expect(() => decodeServerFrame(raw)).toThrow(/objects are forbidden/);
  });

  it("rejects unknown error code (closed taxonomy)", () => {
    const raw = JSON.stringify({
      v: 1,
      type: "error",
      seq: 1,
      code: "MADE_UP_CODE",
      message: "x",
      recoverable: false,
    });
    expect(() => decodeServerFrame(raw)).toThrow(/closed taxonomy/);
  });
});

describe("envelope helpers", () => {
  it("rejects empty delta patches", () => {
    expect(() => delta({ seq: 1, patches: [] })).toThrow(/non-empty/);
  });

  it("rejects empty input patches", () => {
    expect(() => input([])).toThrow(/non-empty/);
  });
});
