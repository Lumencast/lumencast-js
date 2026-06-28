// ADR Blue 009 §3.2–3.3 — the reserved `__cam.*` LSDP leaf observer.
//
// The runtime surfaces the slot→peer assignments (`__cam.slots.*`, Orion #267)
// and the receive-only viewer creds (`__cam.viewer`, Orion #268) to the host
// `onReservedLeaves` sink, de-duplicated by content. The host (Solar) drives its
// slot-binding registry's `assign()` + viewer injection from this projection.

import { describe, expect, it, vi } from "vitest";
import {
  createReservedLeafObserver,
  isReservedCamPath,
  CAM_SLOTS_PREFIX,
  CAM_VIEWER_LEAF,
  type ReservedCamLeaves,
} from "../../src/state/reserved-leaves.js";

describe("isReservedCamPath", () => {
  it("recognises the viewer leaf and every slot leaf, nothing else", () => {
    expect(isReservedCamPath(CAM_VIEWER_LEAF)).toBe(true);
    expect(isReservedCamPath(`${CAM_SLOTS_PREFIX}cam-caster-1`)).toBe(true);
    expect(isReservedCamPath("board.score.blue")).toBe(false);
    expect(isReservedCamPath("__cam")).toBe(false);
    expect(isReservedCamPath("__camviewer")).toBe(false);
  });
});

describe("reserved-leaf observer — snapshot", () => {
  it("projects __cam.slots.* → slotRef:peer_label and __cam.viewer verbatim", () => {
    const emit = vi.fn<(l: ReservedCamLeaves) => void>();
    const obs = createReservedLeafObserver(emit);
    const viewer = { rooms: [{ signalingUrl: "wss://meet", roomId: "r1", token: "t" }] };
    obs.onSnapshot({
      "board.title": "ignored",
      [`${CAM_SLOTS_PREFIX}cam-caster-1`]: "peer-A",
      [`${CAM_SLOTS_PREFIX}cam-caster-2`]: "peer-B",
      [CAM_VIEWER_LEAF]: viewer,
    });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({
      viewer,
      slots: { "cam-caster-1": "peer-A", "cam-caster-2": "peer-B" },
    });
  });

  it("never fires for a plain scene with no reserved leaves", () => {
    const emit = vi.fn();
    const obs = createReservedLeafObserver(emit);
    obs.onSnapshot({ "board.title": "x", "board.score": 3 });
    expect(emit).not.toHaveBeenCalled();
  });

  it("drops malformed slot values (non-string / empty) and empty slotRef", () => {
    const emit = vi.fn<(l: ReservedCamLeaves) => void>();
    const obs = createReservedLeafObserver(emit);
    obs.onSnapshot({
      [`${CAM_SLOTS_PREFIX}cam-1`]: "peer-A",
      [`${CAM_SLOTS_PREFIX}cam-2`]: "",
      [`${CAM_SLOTS_PREFIX}cam-3`]: 42,
      [CAM_SLOTS_PREFIX]: "no-slotref",
    });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![0]).toEqual({ slots: { "cam-1": "peer-A" } });
  });
});

describe("reserved-leaf observer — delta re-keying (RC4, Orion #267)", () => {
  it("re-keys a slot on an assignment delta and emits only on real change", () => {
    const emit = vi.fn<(l: ReservedCamLeaves) => void>();
    const obs = createReservedLeafObserver(emit);
    obs.onSnapshot({ [`${CAM_SLOTS_PREFIX}cam-1`]: "peer-A" });
    expect(emit).toHaveBeenCalledTimes(1);

    // Reassign cam-1 → peer-B.
    obs.onDelta([{ path: `${CAM_SLOTS_PREFIX}cam-1`, value: "peer-B" }]);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[1]![0]).toEqual({ slots: { "cam-1": "peer-B" } });

    // A non-reserved delta does not fire.
    obs.onDelta([{ path: "board.score", value: 7 }]);
    expect(emit).toHaveBeenCalledTimes(2);

    // An idempotent re-emit (same value) does not fire.
    obs.onDelta([{ path: `${CAM_SLOTS_PREFIX}cam-1`, value: "peer-B" }]);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it("releases a slot when the leaf goes empty (→ slot absent, host assigns null)", () => {
    const emit = vi.fn<(l: ReservedCamLeaves) => void>();
    const obs = createReservedLeafObserver(emit);
    obs.onSnapshot({
      [`${CAM_SLOTS_PREFIX}cam-1`]: "peer-A",
      [`${CAM_SLOTS_PREFIX}cam-2`]: "peer-B",
    });
    obs.onDelta([{ path: `${CAM_SLOTS_PREFIX}cam-1`, value: "" }]);
    expect(emit).toHaveBeenLastCalledWith({ slots: { "cam-2": "peer-B" } });
  });

  it("surfaces a late __cam.viewer leaf arriving by delta", () => {
    const emit = vi.fn<(l: ReservedCamLeaves) => void>();
    const obs = createReservedLeafObserver(emit);
    obs.onSnapshot({ [`${CAM_SLOTS_PREFIX}cam-1`]: "peer-A" });
    const viewer = { rooms: [{ signalingUrl: "wss://meet", roomId: "r1", token: "t" }] };
    obs.onDelta([{ path: CAM_VIEWER_LEAF, value: viewer }]);
    expect(emit).toHaveBeenLastCalledWith({ viewer, slots: { "cam-1": "peer-A" } });
  });
});

describe("reserved-leaf observer — snapshot reseed clears stale slots", () => {
  it("a new snapshot without a slot drops it (scene change releases bindings)", () => {
    const emit = vi.fn<(l: ReservedCamLeaves) => void>();
    const obs = createReservedLeafObserver(emit);
    obs.onSnapshot({ [`${CAM_SLOTS_PREFIX}cam-1`]: "peer-A" });
    obs.onSnapshot({ "board.title": "new-scene" });
    expect(emit).toHaveBeenLastCalledWith({ slots: {} });
  });
});
