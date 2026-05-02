import { describe, expect, it } from "vitest";
import {
  formatLeafPath,
  isReservedPath,
  isUnknownReservedPath,
  parseLeafPath,
  substituteScope,
} from "../src/index.js";

describe("parseLeafPath", () => {
  it("parses simple paths", () => {
    expect(parseLeafPath("show.title")).toEqual(["show", "title"]);
  });

  it("parses numeric indices", () => {
    expect(parseLeafPath("players.0.score")).toEqual(["players", "0", "score"]);
  });

  it("parses reserved namespaces", () => {
    expect(parseLeafPath("__inputs.show_title")).toEqual(["__inputs", "show_title"]);
    expect(parseLeafPath("__test.mock.score")).toEqual(["__test", "mock", "score"]);
  });

  it("rejects empty paths", () => {
    expect(() => parseLeafPath("")).toThrow();
  });

  it("rejects segments starting with a digit followed by letters", () => {
    expect(() => parseLeafPath("show.0name")).toThrow();
  });

  it("rejects segments with hyphens or special chars", () => {
    expect(() => parseLeafPath("show.bad-name")).toThrow();
    expect(() => parseLeafPath("show.bad name")).toThrow();
  });
});

describe("formatLeafPath", () => {
  it("round-trips with parseLeafPath", () => {
    const segs = parseLeafPath("__inputs.show_title");
    expect(formatLeafPath(segs)).toBe("__inputs.show_title");
  });
});

describe("isReservedPath", () => {
  it("flags the four reserved namespaces", () => {
    expect(isReservedPath("__inputs.x")).toBe(true);
    expect(isReservedPath("__system.adapter_health.twitch")).toBe(true);
    expect(isReservedPath("__test.foo")).toBe(true);
    expect(isReservedPath("__schema.x")).toBe(true);
  });

  it("does not flag user paths", () => {
    expect(isReservedPath("show.title")).toBe(false);
    expect(isReservedPath("players.0.score")).toBe(false);
  });
});

describe("isUnknownReservedPath", () => {
  it("flags unknown __ namespaces", () => {
    expect(isUnknownReservedPath("__future.thing")).toBe(true);
    expect(isUnknownReservedPath("__internal")).toBe(true);
  });

  it("does not flag the four declared namespaces", () => {
    expect(isUnknownReservedPath("__inputs.x")).toBe(false);
  });

  it("does not flag user paths", () => {
    expect(isUnknownReservedPath("show.title")).toBe(false);
  });
});

describe("substituteScope", () => {
  it("substitutes a single scope", () => {
    expect(substituteScope("{player}.score", { player: "players.0" })).toBe("players.0.score");
  });

  it("substitutes multiple scopes", () => {
    expect(substituteScope("{a}.{b}.value", { a: "rounds.1", b: "teams.2" })).toBe(
      "rounds.1.teams.2.value",
    );
  });

  it("throws on unknown scope", () => {
    expect(() => substituteScope("{unknown}.x", {})).toThrow(/unknown scope/);
  });

  it("leaves non-template paths untouched", () => {
    expect(substituteScope("plain.path", {})).toBe("plain.path");
  });
});
