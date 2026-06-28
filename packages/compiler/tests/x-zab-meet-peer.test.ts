// ADR Blue 009 §3.1 (Amendment 2) — `x-zab.meet-peer` vendor primitive,
// compiler arm. Slot-only : the node declares ONLY a logical `slotRef` (which
// slot of the scene receives a meet peer) + geometry. It carries NO cam/peer
// identity (`camRef`/`camRoomHint` were rejected — voie (b) : the
// slotRef→peer_label binding is stream-level ZabCam state, resolved at runtime).
//
// Covered here :
//   RC1 — a valid meet-peer node compiles WITHOUT DROPPED_FIELD / INVALID_VALUE
//         and preserves `x-zab.slotRef` + geometry in the RenderNode
//         (round-trip identity of the slot, lossless).
//   slotRef validation — an invalid `slotRef` (UUID / colon / uppercase / …)
//         throws INVALID_VALUE ; `size` is required.
//   cam-agnostic — a stray `x-zab.camRef` / `x-zab.camRoomHint` is NOT consumed
//         (warns / strict-throws), proving no cam identity lives in the bundle.
//   hash — `slotRef` is in the hash (structural identity : two slots differ) ;
//         a bundle WITHOUT meet-peer hashes identically (purely additive).

import { describe, expect, it, vi } from "vitest";
import { compileBundle, hashBundle, ZERO_HASH, type LSMLBundle } from "../src/index.js";

const base: Omit<LSMLBundle, "layout"> = {
  lsml: "1.1",
  scene_id: "test",
  scene_version: ZERO_HASH,
};

describe("x-zab.meet-peer — RC1 : compiles, preserves slotRef + geometry, no drop", () => {
  it("compiles a meet-peer slot node with no diagnostic", () => {
    const onWarn = vi.fn();
    const out = compileBundle(
      {
        ...base,
        layout: {
          kind: "x-zab.meet-peer",
          id: "cam-caster-1-slot",
          "x-zab.slotRef": "cam-caster-1",
          size: { w: 640, h: 360 },
          opacity: 1,
        },
      },
      { onWarn },
    );
    expect(onWarn).not.toHaveBeenCalled();
    expect(out.root.kind).toBe("x-zab.meet-peer");
    expect(out.root.props).toMatchObject({
      "x-zab.slotRef": "cam-caster-1",
      width: 640,
      height: 360,
      opacity: 1,
    });
  });

  it("strict mode does not throw on a valid meet-peer node", () => {
    expect(() =>
      compileBundle(
        {
          ...base,
          layout: {
            kind: "x-zab.meet-peer",
            "x-zab.slotRef": "cam-guest",
            size: { w: 1280, h: 720 },
          },
        },
        { strict: true },
      ),
    ).not.toThrow();
  });

  it("carries NO cam/peer identity — only slotRef + geometry reach the bundle", () => {
    const out = compileBundle({
      ...base,
      layout: {
        kind: "x-zab.meet-peer",
        "x-zab.slotRef": "cam-caster-1",
        size: { w: 640, h: 360 },
      },
    });
    expect(out.root.props).not.toHaveProperty("x-zab.camRef");
    expect(out.root.props).not.toHaveProperty("x-zab.camRoomHint");
    expect(out.root.props).not.toHaveProperty("peer_label");
  });
});

describe("x-zab.meet-peer — slotRef validation (INVALID_VALUE / throws)", () => {
  it.each([
    ["a UUID", "550e8400-e29b-41d4-a716-446655440000"],
    ["a room id with colon", "room:0"],
    ["uppercase", "Cam-Caster-1"],
    ["a leading digit", "1cam"],
    ["over 64 chars", "a".repeat(65)],
    ["empty", ""],
  ])("rejects %s", (_label, ref) => {
    expect(() =>
      compileBundle({
        ...base,
        layout: {
          kind: "x-zab.meet-peer",
          id: "slot",
          "x-zab.slotRef": ref,
          size: { w: 640, h: 360 },
        },
      }),
    ).toThrow(/x-zab\.slotRef/);
  });

  it("never echoes the offending slotRef value", () => {
    try {
      compileBundle({
        ...base,
        layout: {
          kind: "x-zab.meet-peer",
          id: "slot",
          "x-zab.slotRef": "room:SECRET-SLOT",
          size: { w: 1, h: 1 },
        },
      });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as Error).message).not.toContain("SECRET-SLOT");
    }
  });

  it("rejects a meet-peer node missing size", () => {
    expect(() =>
      compileBundle({
        ...base,
        layout: {
          kind: "x-zab.meet-peer",
          "x-zab.slotRef": "cam-caster-1",
        } as never,
      }),
    ).toThrow(/size/);
  });

  it("rejects a stray cam identity prop in strict mode (cam-agnostic, voie b)", () => {
    expect(() =>
      compileBundle(
        {
          ...base,
          layout: {
            kind: "x-zab.meet-peer",
            "x-zab.slotRef": "cam-caster-1",
            size: { w: 640, h: 360 },
            "x-zab.camRef": "caster_1",
          } as never,
        },
        { strict: true },
      ),
    ).toThrow();
  });
});

describe("x-zab.meet-peer — hash : slotRef is structural identity", () => {
  const slot = (slotRef: string): LSMLBundle => ({
    ...base,
    layout: {
      kind: "x-zab.meet-peer",
      "x-zab.slotRef": slotRef,
      size: { w: 640, h: 360 },
    },
  });

  it("two slots with different slotRef hash differently (in-hash identity)", async () => {
    const a = await hashBundle(compileBundle(slot("cam-caster-1")));
    const b = await hashBundle(compileBundle(slot("cam-caster-2")));
    expect(a.scene_version).not.toBe(b.scene_version);
  });

  it("the same slotRef round-trips to a stable hash (deterministic)", async () => {
    const a = await hashBundle(compileBundle(slot("cam-caster-1")));
    const b = await hashBundle(compileBundle(structuredClone(slot("cam-caster-1"))));
    expect(a.scene_version).toBe(b.scene_version);
  });
});

describe("x-zab.meet-peer — bundles without meet-peer are unchanged (additive)", () => {
  const noMeet: LSMLBundle = {
    ...base,
    layout: {
      kind: "frame",
      size: { w: 1920, h: 1080 },
      background: "#000",
      children: [{ kind: "image", alt: "logo", size: { w: 96, h: 64 }, fit: "contain" }],
    },
  };

  it("hashes a non-meet bundle the same as a baseline copy (additive case)", async () => {
    const a = await hashBundle(compileBundle(noMeet));
    const b = await hashBundle(compileBundle(structuredClone(noMeet)));
    expect(a.scene_version).toBe(b.scene_version);
  });
});
