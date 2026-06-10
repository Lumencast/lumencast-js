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
        style: { fontSize: 32, fontFamily: "Bebas Neue", color: "#ffffff", fontWeight: 700 },
        bind: { value: "show.title" },
      },
      {
        kind: "frame",
        size: { w: 1920, h: 1080 },
        background: "#000",
        children: [{ kind: "image", alt: "logo", size: { w: 96, h: 64 }, fit: "contain" }],
      },
    ],
  },
};

describe("compileBundle", () => {
  it("rejects unsupported LSML versions", () => {
    expect(() =>
      compileBundle({ ...minimalLsml, lsml: "2.0" as unknown as "1.0" | "1.1" }),
    ).toThrow(/version "2\.0" is not supported/);
  });

  it("accepts LSML 1.1 bundles", () => {
    const out = compileBundle({ ...minimalLsml, lsml: "1.1" });
    expect(out.scene_version).toBe(ZERO_HASH);
    expect(out.root.kind).toBe("stack");
  });

  it("compiles 1.1 instance primitives", () => {
    const out = compileBundle({
      ...minimalLsml,
      lsml: "1.1",
      layout: {
        kind: "instance",
        scene_id: "scoreboard",
        scene_version: "sha256:" + "a".repeat(64),
        size: { w: 800, h: 240 },
        fit: "contain",
        params: { team_a: "Alpha" },
        bindParams: { team_b: "match.opponent" },
      },
    });
    expect(out.root.kind).toBe("instance");
    expect(out.root.props).toMatchObject({
      scene_id: "scoreboard",
      width: 800,
      height: 240,
      fit: "contain",
      params: { team_a: "Alpha" },
    });
    expect(out.root.bindings).toMatchObject({ "params.team_b": "match.opponent" });
  });

  it("forwards 1.1 universal props (visible / opacity / rotation / sizing) to the renderer", () => {
    const out = compileBundle({
      ...minimalLsml,
      lsml: "1.1",
      layout: {
        kind: "text",
        bind: { value: "x" },
        visible: false,
        opacity: 0.5,
        rotation: 45,
        sizing: { x: "fixed", y: "hug" },
      },
    });
    expect(out.root.props).toMatchObject({
      visible: false,
      opacity: 0.5,
      rotation: 45,
      sizing: { x: "fixed", y: "hug" },
    });
  });

  it("forwards 1.1 bindUniversal entries into the bindings map", () => {
    const out = compileBundle({
      ...minimalLsml,
      lsml: "1.1",
      layout: {
        kind: "text",
        bind: { value: "x" },
        bindUniversal: { visible: "show.is_live", opacity: "fade.alpha" },
      },
    });
    expect(out.root.bindings).toMatchObject({
      visible: "show.is_live",
      opacity: "fade.alpha",
    });
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

  it("maps text style.* to Solar primitive vocab (size/font/weight/colour)", () => {
    const out = compileBundle(minimalLsml);
    const text = out.root.children?.[0];
    expect(text?.kind).toBe("text");
    // style.fontFamily lowers to `font` (text.tsx reads resolved.font).
    expect(text?.props).toMatchObject({
      size: 32,
      font: "Bebas Neue",
      weight: 700,
      colour: "#ffffff",
    });
    expect(text?.bindings).toEqual({ value: "show.title" });
  });

  it("forwards the full TextStyle 1.1 typography + maxLines (issue #31)", () => {
    const out = compileBundle({
      ...minimalLsml,
      lsml: "1.1",
      layout: {
        kind: "text",
        bind: { value: "show.title" },
        style: {
          fontSize: 24,
          lineHeight: 1.2,
          letterSpacing: 0.5,
          textTransform: "uppercase",
          textDecoration: "underline",
          fontStyle: "italic",
        },
        maxLines: 2,
      },
    });
    expect(out.root.kind).toBe("text");
    expect(out.root.props).toMatchObject({
      size: 24,
      lineHeight: 1.2,
      letterSpacing: 0.5,
      textTransform: "uppercase",
      textDecoration: "underline",
      fontStyle: "italic",
      maxLines: 2,
    });
  });

  it("compiles a frame with size + background", () => {
    const out = compileBundle(minimalLsml);
    const frame = out.root.children?.[1];
    expect(frame?.kind).toBe("frame");
    expect(frame?.props).toMatchObject({ width: 1920, height: 1080, background: "#000" });
  });

  it("maps image size.{w,h} to flat width/height (image.tsx honours them)", () => {
    const out = compileBundle(minimalLsml);
    const frame = out.root.children?.[1];
    const image = frame?.children?.[0];
    expect(image?.kind).toBe("image");
    expect(image?.props).toMatchObject({ width: 96, height: 64, fit: "contain", alt: "logo" });
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

  it("lowers animate.from into a flat animate_initial map (mount-play)", () => {
    const lsml: LSMLBundle = {
      ...minimalLsml,
      layout: {
        kind: "image",
        alt: "logo",
        size: { w: 200, h: 200 },
        animate: {
          from: { opacity: 0, transform: { scale: 0.85 } },
          transition: { duration: 550, easing: "ease-out" },
          opacity: 1,
          transform: { scale: 1 },
        },
      },
    };
    const out = compileBundle(lsml);
    expect(out.root.animate_initial).toEqual({ opacity: 0, scale: 0.85 });
    // the existing transition lowering is unaffected
    expect(out.root.transitions).toMatchObject({
      opacity: { kind: "tween", duration_ms: 550, ease: "cubic-out" },
      scale: { kind: "tween", duration_ms: 550, ease: "cubic-out" },
    });
  });

  it("lowers from.transform.translate and rotate into x/y/rotate", () => {
    const lsml: LSMLBundle = {
      ...minimalLsml,
      layout: {
        kind: "frame",
        size: { w: 100, h: 100 },
        animate: {
          from: { transform: { translate: [40, -20], rotate: 90 }, opacity: 0 },
          transition: { duration: 300 },
          opacity: 1,
        },
      },
    };
    const out = compileBundle(lsml);
    expect(out.root.animate_initial).toEqual({ opacity: 0, x: 40, y: -20, rotate: 90 });
  });

  it("REGRESSION: animate without from emits no animate_initial", () => {
    const lsml: LSMLBundle = {
      ...minimalLsml,
      layout: {
        kind: "image",
        alt: "logo",
        size: { w: 100, h: 100 },
        animate: { transition: { duration: 200, easing: "ease-out" }, opacity: 1 },
      },
    };
    const out = compileBundle(lsml);
    expect(out.root.animate_initial).toBeUndefined();
    expect(out.root.transitions).toMatchObject({ opacity: { kind: "tween" } });
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
