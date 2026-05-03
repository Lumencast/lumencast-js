import { describe, expect, it } from "vitest";
import { delta as deltaFrame, snapshot as snapshotFrame } from "@lumencast/protocol";
import { createStore } from "../../src/state/store.js";
import { applySnapshot } from "../../src/state/apply-snapshot.js";
import { applyDelta } from "../../src/state/apply-delta.js";

describe("state — apply-snapshot + apply-delta", () => {
  it("seeds the store from a snapshot", () => {
    const store = createStore();
    applySnapshot(
      store,
      snapshotFrame({
        seq: 1,
        scene_id: "main",
        scene_version: "sha256:1",
        state: { "show.title": "Live", "players.0.score": 0 },
      }),
    );
    expect(store.signal("show.title").value).toBe("Live");
    expect(store.signal("players.0.score").value).toBe(0);
  });

  it("applies delta patches", () => {
    const store = createStore();
    applySnapshot(
      store,
      snapshotFrame({
        seq: 1,
        scene_id: "main",
        scene_version: "sha256:1",
        state: { "score.home": 0 },
      }),
    );
    applyDelta(
      store,
      deltaFrame({
        seq: 2,
        patches: [
          { path: "score.home", value: 1 },
          { path: "score.away", value: 2 },
        ],
      }),
    );
    expect(store.signal("score.home").value).toBe(1);
    expect(store.signal("score.away").value).toBe(2);
  });

  it("delta patch carrying a transition surfaces on the per-path transition signal", () => {
    const store = createStore();
    applyDelta(
      store,
      deltaFrame({
        seq: 1,
        patches: [
          {
            path: "score.home",
            value: 7,
            transition: { kind: "tween", duration_ms: 250, easing: "ease-in-out" },
          },
        ],
      }),
    );
    expect(store.signal("score.home").value).toBe(7);
    const tx = store.transitionSignal("score.home").value;
    expect(tx?.kind).toBe("tween");
    expect(tx).toMatchObject({ kind: "tween", duration_ms: 250, ease: "cubic-in-out" });
  });

  it("snap kind degrades to the no-transition runtime form", () => {
    const store = createStore();
    applyDelta(
      store,
      deltaFrame({
        seq: 1,
        patches: [{ path: "x", value: 1, transition: { kind: "snap" } }],
      }),
    );
    expect(store.transitionSignal("x").value).toEqual({ kind: "none" });
  });

  it("snapshot clears any pending per-path transition directive", () => {
    const store = createStore();
    applyDelta(
      store,
      deltaFrame({
        seq: 1,
        patches: [{ path: "x", value: 1, transition: { kind: "tween", duration_ms: 100 } }],
      }),
    );
    expect(store.transitionSignal("x").value).not.toBeUndefined();
    applySnapshot(
      store,
      snapshotFrame({
        seq: 2,
        scene_id: "main",
        scene_version: "sha256:1",
        state: { x: 9 },
      }),
    );
    expect(store.transitionSignal("x").value).toBeUndefined();
    expect(store.signal("x").value).toBe(9);
  });

  it("snapshot reset clears paths missing from new snapshot", () => {
    const store = createStore();
    applySnapshot(
      store,
      snapshotFrame({
        seq: 1,
        scene_id: "a",
        scene_version: "sha256:1",
        state: { x: 1, y: 2 },
      }),
    );
    applySnapshot(
      store,
      snapshotFrame({
        seq: 1,
        scene_id: "b",
        scene_version: "sha256:2",
        state: { y: 99 },
      }),
    );
    expect(store.signal("x").value).toBeUndefined();
    expect(store.signal("y").value).toBe(99);
  });
});
