import { describe, expect, it } from "vitest";
import {
  canonicalize,
  compileBundle,
  hashBundle,
  ZERO_HASH,
  type LSMLBundle,
} from "../src/index.js";

const minimalLsml: LSMLBundle = {
  lsml: "1.0",
  scene_id: "test",
  scene_version: ZERO_HASH,
  layout: {
    kind: "stack",
    direction: "vertical",
    gap: 12,
    align: "center",
    justify: "start",
    children: [
      {
        kind: "text",
        style: { fontSize: 32, color: "#ffffff", fontWeight: 700 },
        bind: { value: "show.title" },
      },
      {
        kind: "frame",
        size: { w: 1920, h: 1080 },
        background: "#000",
        children: [],
      },
    ],
  },
};

describe("compileBundle", () => {
  it("rejects non-1.0 LSML", () => {
    expect(() => compileBundle({ ...minimalLsml, lsml: "2.0" as unknown as "1.0" })).toThrow(
      /only LSML 1.0/,
    );
  });

  it("compiles a stack with children", () => {
    const out = compileBundle(minimalLsml);
    expect(out.scene_version).toBe(ZERO_HASH);
    expect(out.root.kind).toBe("stack");
    expect(out.root.props).toMatchObject({
      direction: "vertical",
      gap: 12,
      align: "center",
      justify: "flex-start",
    });
    expect(out.root.children).toHaveLength(2);
  });

  it("maps text style.* to Solar primitive vocab (size/weight/colour)", () => {
    const out = compileBundle(minimalLsml);
    const text = out.root.children?.[0];
    expect(text?.kind).toBe("text");
    expect(text?.props).toMatchObject({ size: 32, weight: 700, colour: "#ffffff" });
    expect(text?.bindings).toEqual({ value: "show.title" });
  });

  it("compiles a frame with size + background", () => {
    const out = compileBundle(minimalLsml);
    const frame = out.root.children?.[1];
    expect(frame?.kind).toBe("frame");
    expect(frame?.props).toMatchObject({ width: 1920, height: 1080, background: "#000" });
  });

  it("compiles a repeat into bindings.items + children:[template]", () => {
    const lsml: LSMLBundle = {
      ...minimalLsml,
      layout: {
        kind: "repeat",
        scope: "p",
        bind: { items: "players" },
        template: { kind: "text", bind: { value: "{p}.name" } },
      },
    };
    const out = compileBundle(lsml);
    expect(out.root.kind).toBe("repeat");
    expect(out.root.bindings).toEqual({ items: "players" });
    expect(out.root.children).toHaveLength(1);
    expect(out.root.children?.[0]?.kind).toBe("text");
    expect(out.root.children?.[0]?.bindings).toEqual({ value: "{p}.name" });
  });

  it("compiles animate.transition into a tween transition", () => {
    const lsml: LSMLBundle = {
      ...minimalLsml,
      layout: {
        kind: "frame",
        size: { w: 100, h: 100 },
        animate: {
          transition: { duration: 200, easing: "ease-out" },
          opacity: 1,
        },
      },
    };
    const out = compileBundle(lsml);
    expect(out.root.transitions).toMatchObject({
      opacity: { kind: "tween", duration_ms: 200, ease: "cubic-out" },
    });
  });

  it("propagates operator_inputs", () => {
    const lsml: LSMLBundle = {
      ...minimalLsml,
      operator_inputs: [
        {
          path: "__inputs.show_title",
          label: "Show title",
          type: "string",
          writable_by: ["operator"],
        },
      ],
    };
    const out = compileBundle(lsml);
    expect(out.operator_inputs).toEqual([
      {
        path: "__inputs.show_title",
        label: "Show title",
        type: "string",
        writable_by: ["operator"],
      },
    ]);
  });
});

describe("canonicalize", () => {
  it("sorts keys lexicographically at every level", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ z: { y: 1, x: 2 } })).toBe('{"z":{"x":2,"y":1}}');
  });

  it("emits no insignificant whitespace", () => {
    const s = canonicalize({ a: [1, 2, { x: "hi" }] });
    expect(s).toBe('{"a":[1,2,{"x":"hi"}]}');
  });

  it("handles primitives", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize(42)).toBe("42");
    expect(canonicalize("hi")).toBe('"hi"');
  });
});

describe("hashBundle", () => {
  it("produces a sha256:<64-hex> scene_version", async () => {
    const stamped = await hashBundle({
      scene_id: "x",
      scene_version: ZERO_HASH,
      payload: { a: 1 },
    });
    expect(stamped.scene_version).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is deterministic across calls", async () => {
    const a = await hashBundle({ scene_id: "x", scene_version: ZERO_HASH, a: 1, b: 2 });
    const b = await hashBundle({ scene_id: "x", scene_version: ZERO_HASH, b: 2, a: 1 });
    expect(a.scene_version).toBe(b.scene_version);
  });

  it("changes hash when payload changes", async () => {
    const a = await hashBundle({ scene_id: "x", scene_version: ZERO_HASH, a: 1 });
    const b = await hashBundle({ scene_id: "x", scene_version: ZERO_HASH, a: 2 });
    expect(a.scene_version).not.toBe(b.scene_version);
  });
});
