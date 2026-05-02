import { describe, expect, it, vi } from "vitest";
import { createScene, LeafStore, canWritePath } from "../src/index.js";

describe("LeafStore", () => {
  it("seeds initial state and snapshots it", () => {
    const s = new LeafStore({ "a.b": 1, "c.d": "x" });
    expect(s.snapshot()).toEqual({ "a.b": 1, "c.d": "x" });
    expect(s.get("a.b")).toBe(1);
  });

  it("applies patches and notifies listeners", () => {
    const s = new LeafStore();
    const seen: unknown[] = [];
    s.onPatches((p) => seen.push(p));
    s.apply([{ path: "x", value: 1 }]);
    s.apply([{ path: "y", value: "z" }]);
    expect(seen).toEqual([[{ path: "x", value: 1 }], [{ path: "y", value: "z" }]]);
    expect(s.snapshot()).toEqual({ x: 1, y: "z" });
  });

  it("does not notify on empty patch arrays", () => {
    const s = new LeafStore();
    const fn = vi.fn();
    s.onPatches(fn);
    s.apply([]);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("Scene", () => {
  it("update accepts patch arrays and record forms", () => {
    const scene = createScene({
      sceneId: "a",
      sceneVersion: "sha256:1",
      initialState: { score: 0 },
    });
    scene.update([{ path: "score", value: 1 }]);
    expect(scene.store.get("score")).toBe(1);
    scene.update({ score: 2, "show.title": "Live" });
    expect(scene.store.get("score")).toBe(2);
    expect(scene.store.get("show.title")).toBe("Live");
  });
});

describe("canWritePath", () => {
  it("viewer never writes", () => {
    expect(canWritePath({ role: "viewer" }, "__inputs.x")).toBe(false);
    expect(canWritePath({ role: "viewer" }, "x.y")).toBe(false);
  });

  it("operator writes only __inputs.*", () => {
    expect(canWritePath({ role: "operator" }, "__inputs.x")).toBe(true);
    expect(canWritePath({ role: "operator" }, "x.y")).toBe(false);
    expect(canWritePath({ role: "operator" }, "__test.x")).toBe(false);
  });

  it("service is restricted by paths claim", () => {
    expect(
      canWritePath({ role: "service", paths: ["__inputs.scoreboard"] }, "__inputs.scoreboard.home"),
    ).toBe(true);
    expect(
      canWritePath({ role: "service", paths: ["__inputs.scoreboard"] }, "__inputs.show_title"),
    ).toBe(false);
  });

  it("test role only writes __test.*", () => {
    expect(canWritePath({ role: "test" }, "__test.mock")).toBe(true);
    expect(canWritePath({ role: "test" }, "__inputs.x")).toBe(false);
  });
});
