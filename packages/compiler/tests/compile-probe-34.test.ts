// Probe — Issue #34 (PR #46, branch forge/34-anti-drop)
// ADR 001 §3.4 D4, §5.1 R9, §6 RC#7.
//
// This file COMPLEMENTS Forge's compile-anti-drop.test.ts without
// duplicating it.  Every assertion is executable and targets a gap in
// the existing suite.
//
// Scope :
//   A. Exhaustiveness of consumed-key accounting per primitive kind —
//      every KIND_NODE_KEYS set is exercised with all its members present
//      (no spurious warn) AND with an extra unknown key (warn fires).
//   B. Compiler strict-throw R9 hygiene — the Error.message never carries
//      the offending value, even when the value is embedded in the key
//      name (structural path like "style.textShadow").
//   C. Bundle-level field exhaustiveness — all BUNDLE_KEYS are forwarded
//      silently; a novel unknown extension warns once with nodeId <bundle>.
//   D. R9 cross-channel — onWarn message AND structured diagnostic never
//      contain the sentinel value.
//   E. Text node: maxLines / lineHeight / letterSpacing / fontFamily are
//      FORWARDED (no compiler cap) — runtime validates them.  Verify the
//      compiler emits them unchanged even for values that the runtime
//      would later reject.
//   F. Interaction: two sibling nodes with the same unknown key both warn
//      independently (no cross-node dedup at compile time).

import { describe, expect, it } from "vitest";
import {
  compileBundle,
  ZERO_HASH,
  type CompileDiagnostic,
  type LSMLBundle,
  type LSMLNode,
} from "../src/index.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

const SENTINEL = "R9SENTINEL34probe";

function bundle(layout: LSMLNode, extra: Record<string, unknown> = {}): LSMLBundle {
  return {
    lsml: "1.1",
    scene_id: "probe34",
    scene_version: ZERO_HASH,
    layout,
    ...extra,
  } as LSMLBundle;
}

function collect(b: LSMLBundle): { messages: string[]; diagnostics: CompileDiagnostic[] } {
  const messages: string[] = [];
  const diagnostics: CompileDiagnostic[] = [];
  compileBundle(b, {
    onWarn: (message, diagnostic) => {
      messages.push(message);
      diagnostics.push(diagnostic);
    },
  });
  return { messages, diagnostics };
}

function hasField(diagnostics: CompileDiagnostic[], field: string): boolean {
  return diagnostics.some((d) => d.field === field);
}

// ─── A. KIND_NODE_KEYS exhaustiveness ────────────────────────────────────────
//
// For every primitive, compile a fully-spec'd node (all known keys present).
// Expectation: 0 warnings.  Then add one unknown key and expect 1 warning.

describe("A — KIND_NODE_KEYS exhaustiveness : no spurious warn on full spec'd node", () => {
  it("stack: all consumed keys → silent", () => {
    const { diagnostics } = collect(
      bundle({
        kind: "stack",
        id: "s",
        direction: "horizontal",
        gap: 8,
        align: "center",
        justify: "space-between",
        padding: 4,
        rtl: false,
        visible: true,
        opacity: 1,
        rotation: 0,
        sizing: { x: "fill" },
        position: { x: 0, y: 0 },
        children: [],
      }),
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stack: unknown key 'overflow' warns once with node id", () => {
    const { diagnostics } = collect(
      bundle({
        kind: "stack",
        id: "sflow",
        gap: 8,
        overflow: "hidden",
      } as unknown as LSMLNode),
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ nodeId: "sflow", field: "overflow" }),
    );
    expect(diagnostics).toHaveLength(1);
  });

  it("grid: all consumed keys → silent", () => {
    const { diagnostics } = collect(
      bundle({
        kind: "grid",
        id: "g",
        columns: 3,
        rows: 2,
        gap: 4,
        padding: 8,
      }),
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("grid: unknown key 'autoFlow' warns", () => {
    const { diagnostics } = collect(
      bundle({ kind: "grid", id: "g2", columns: 3, autoFlow: "row" } as unknown as LSMLNode),
    );
    expect(diagnostics).toContainEqual(expect.objectContaining({ nodeId: "g2", field: "autoFlow" }));
  });

  it("frame: all consumed keys → silent", () => {
    const { diagnostics } = collect(
      bundle({
        kind: "frame",
        id: "f",
        size: { w: 100, h: 50 },
        position: { x: 0, y: 0 },
        background: "#fff",
        backgrounds: [{ kind: "solid", color: "#000" }],
        clipsContent: true,
        visible: true,
        opacity: 0.5,
        rotation: 45,
        sizing: { x: "fixed", y: "hug" },
        children: [],
      }),
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("frame: unknown key 'borderRadius' warns", () => {
    const { diagnostics } = collect(
      bundle({
        kind: "frame",
        id: "fbr",
        size: { w: 10, h: 10 },
        borderRadius: 8,
      } as unknown as LSMLNode),
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ nodeId: "fbr", field: "borderRadius" }),
    );
  });

  it("text: all consumed keys → silent", () => {
    const { diagnostics } = collect(
      bundle({
        kind: "text",
        id: "t",
        style: {
          fontSize: 16,
          fontFamily: "Inter",
          fontWeight: 400,
          color: "#fff",
          textAlign: "start",
          lineHeight: 1.2,
          letterSpacing: 0.5,
          textTransform: "none",
          textDecoration: "underline",
          fontStyle: "normal",
        },
        format: { kind: "number" },
        maxLines: 3,
        bind: { value: "score" },
      }),
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("text: unknown key 'truncation' warns", () => {
    const { diagnostics } = collect(
      bundle({ kind: "text", id: "ttr", truncation: "middle" } as unknown as LSMLNode),
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ nodeId: "ttr", field: "truncation" }),
    );
  });

  it("image: all consumed keys → silent", () => {
    const { diagnostics } = collect(
      bundle({
        kind: "image",
        id: "img",
        alt: "logo",
        size: { w: 100, h: 80 },
        fit: "contain",
        bind: { src: "logo.url" },
      }),
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("image: unknown key 'loading' warns", () => {
    const { diagnostics } = collect(
      bundle({ kind: "image", id: "img2", alt: "x", size: { w: 1, h: 1 }, loading: "lazy" } as unknown as LSMLNode),
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ nodeId: "img2", field: "loading" }),
    );
  });

  it("shape: all consumed keys → silent", () => {
    const { diagnostics } = collect(
      bundle({
        kind: "shape",
        id: "sh",
        geometry: "rect",
        size: { w: 10, h: 10 },
        pathData: "M 0 0 L 10 10 Z",
        paths: [{ data: "M 0 0 L 1 1 Z", windingRule: "NONZERO" }],
        fill: "#fff",
        fills: [{ kind: "solid", color: "#000" }],
        stroke: { color: "#000", width: 1 },
        strokes: [{ color: "#red", width: 2 }],
        cornerRadius: 4,
        ariaLabel: "shape",
        visible: true,
      }),
    );
    // pathData + paths coexist → 1 warn about mutual exclusivity, not more.
    expect(diagnostics.filter((d) => d.field !== "pathData")).toHaveLength(0);
  });

  it("shape: unknown key 'shadow' warns", () => {
    const { diagnostics } = collect(
      bundle({ kind: "shape", id: "sh2", geometry: "rect", shadow: true } as unknown as LSMLNode),
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ nodeId: "sh2", field: "shadow" }),
    );
  });

  it("media: all consumed keys → silent", () => {
    const { diagnostics } = collect(
      bundle({
        kind: "media",
        id: "mv",
        kind_hint: "video",
        controls: true,
        autoplay: false,
        muted: true,
        loop: false,
        size: { w: 640, h: 360 },
        bind: { src: "video.url" },
      }),
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("media: unknown key 'preload' warns", () => {
    const { diagnostics } = collect(
      bundle({
        kind: "media",
        id: "mv2",
        kind_hint: "video",
        preload: "auto",
      } as unknown as LSMLNode),
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ nodeId: "mv2", field: "preload" }),
    );
  });

  it("instance: all consumed keys → silent", () => {
    const { diagnostics } = collect(
      bundle({
        kind: "instance",
        id: "inst",
        scene_id: "sub",
        scene_version: ZERO_HASH,
        size: { w: 400, h: 300 },
        fit: "contain",
        params: { score: 0 },
        bindParams: { score: "score.home" },
        visible: true,
      }),
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("instance: unknown key 'fallback' warns", () => {
    const { diagnostics } = collect(
      bundle({
        kind: "instance",
        id: "inst2",
        scene_id: "s",
        scene_version: ZERO_HASH,
        fallback: "loading",
      } as unknown as LSMLNode),
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ nodeId: "inst2", field: "fallback" }),
    );
  });

  it("repeat: all consumed keys → silent", () => {
    const { diagnostics } = collect(
      bundle({
        kind: "repeat",
        id: "rpt",
        scope: "row",
        bind: { items: "rows" },
        template: { kind: "text", id: "tpl" },
        stagger_ms: 50,
      }),
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("repeat: unknown key 'direction' warns (not in REPEAT_NODE_KEYS)", () => {
    const { diagnostics } = collect(
      bundle({
        kind: "repeat",
        id: "rpt2",
        scope: "r",
        bind: { items: "i" },
        template: { kind: "text" },
        direction: "vertical",
      } as unknown as LSMLNode),
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ nodeId: "rpt2", field: "direction" }),
    );
  });
});

// ─── B. Compiler strict-throw R9 — Error.message never carries the value ──────

describe("B — strict-throw R9 : Error.message contains node+field, not value", () => {
  it("unknown node key: error names node+field but not the sentinel value", () => {
    try {
      compileBundle(
        bundle({ kind: "frame", id: "fr", effects: [{ value: SENTINEL }] } as unknown as LSMLNode),
        { strict: true },
      );
      expect.unreachable("strict must throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('"fr"');
      expect(msg).toContain("effects");
      expect(msg).not.toContain(SENTINEL);
    }
  });

  it("unknown text style key: error names node+style.field but not the sentinel", () => {
    try {
      compileBundle(
        bundle({
          kind: "text",
          id: "t1",
          style: { fontSize: 16, unknownTypo: SENTINEL },
        } as unknown as LSMLNode),
        { strict: true },
      );
      expect.unreachable("strict must throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('"t1"');
      expect(msg).toContain("style.unknownTypo");
      expect(msg).not.toContain(SENTINEL);
    }
  });

  it("bundle-level key: error names <bundle>+field but not the sentinel", () => {
    try {
      compileBundle(
        bundle({ kind: "frame" }, { defaults: { key: SENTINEL } }),
        { strict: true },
      );
      expect.unreachable("strict must throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("<bundle>");
      expect(msg).toContain("defaults");
      expect(msg).not.toContain(SENTINEL);
    }
  });

  it("onWarn message and diagnostic never contain the sentinel value", () => {
    const { messages, diagnostics } = collect(
      bundle(
        {
          kind: "frame",
          id: "fr",
          mask: SENTINEL,
          blendMode: SENTINEL,
        } as unknown as LSMLNode,
        { defaults: { hidden: SENTINEL }, i18n: { default_locale: SENTINEL } },
      ),
    );
    const all = messages.join(" ") + JSON.stringify(diagnostics);
    expect(all).not.toContain(SENTINEL);
    // The fields are named:
    expect(all).toContain("mask");
    expect(all).toContain("blendMode");
    expect(all).toContain("defaults");
    expect(all).toContain("i18n");
  });
});

// ─── C. Bundle-level BUNDLE_KEYS exhaustiveness ────────────────────────────

describe("C — bundle-level BUNDLE_KEYS : all known keys forwarded silently", () => {
  it("all BUNDLE_KEYS present → 0 warnings", () => {
    const { diagnostics } = collect(
      bundle(
        { kind: "frame", id: "f" },
        {
          $schema: "https://lumencast.com/schema/1.1",
          scene_id: "t",
          scene_version: ZERO_HASH,
          profiles: [],
          operator_inputs: [],
          external_adapters: [],
          // lsml already set by bundle() helper
        },
      ),
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("two novel bundle-level extensions → 2 warnings, both nodeId <bundle>", () => {
    const { diagnostics } = collect(
      bundle({ kind: "frame" }, { customExt1: "a", customExt2: "b" }),
    );
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.every((d) => d.nodeId === "<bundle>")).toBe(true);
    expect(hasField(diagnostics, "customExt1")).toBe(true);
    expect(hasField(diagnostics, "customExt2")).toBe(true);
  });
});

// ─── D. R9 cross-channel ────────────────────────────────────────────────────

describe("D — R9 : onWarn message AND structured diagnostic never carry value", () => {
  it("three unknown keys with sentinel-valued nodes: sentinel never appears anywhere", () => {
    const { messages, diagnostics } = collect(
      bundle(
        {
          kind: "stack",
          id: "root",
          customA: { nested: SENTINEL },
          children: [
            {
              kind: "text",
              id: "child",
              style: { fontSize: 12, textShadow: SENTINEL },
              customB: SENTINEL,
            } as unknown as LSMLNode,
          ],
        } as unknown as LSMLNode,
        { customBundleKey: SENTINEL },
      ),
    );
    const all = messages.join(" ") + JSON.stringify(diagnostics);
    expect(all).not.toContain(SENTINEL);
    // Fields are named, not values.
    expect(all).toContain("customA");
    expect(all).toContain("style.textShadow");
    expect(all).toContain("customB");
    expect(all).toContain("customBundleKey");
  });
});

// ─── E. Text typo fields are forwarded unchanged at compile time ──────────────
//
// The compiler does NOT cap maxLines / lineHeight / letterSpacing / fontFamily.
// Those are runtime-side gates (text.tsx).  Verify no compiler warning fires
// and the values reach the RenderNode props unchanged.

describe("E — typo props forwarded as-is (compiler is not the cap gate)", () => {
  it("maxLines: absurd-large value compiles without warn, value forwarded", () => {
    const { diagnostics, ..._ } = collect(
      bundle({ kind: "text", id: "t", maxLines: 999_999 }),
    );
    expect(diagnostics).toHaveLength(0);
    const out = compileBundle(bundle({ kind: "text", id: "t", maxLines: 999_999 }));
    expect(out.root.props?.maxLines).toBe(999_999);
  });

  it("lineHeight: absurd value compiles without warn, value forwarded", () => {
    const { diagnostics } = collect(
      bundle({ kind: "text", id: "t", style: { lineHeight: 9999 } }),
    );
    expect(diagnostics).toHaveLength(0);
    const out = compileBundle(bundle({ kind: "text", id: "t", style: { lineHeight: 9999 } }));
    expect(out.root.props?.lineHeight).toBe(9999);
  });

  it("letterSpacing: huge negative compiles without warn, value forwarded", () => {
    const { diagnostics } = collect(
      bundle({ kind: "text", id: "t", style: { letterSpacing: -50_000 } }),
    );
    expect(diagnostics).toHaveLength(0);
    const out = compileBundle(
      bundle({ kind: "text", id: "t", style: { letterSpacing: -50_000 } }),
    );
    expect(out.root.props?.letterSpacing).toBe(-50_000);
  });

  it("fontFamily: string with ASCII-only content compiles without warn", () => {
    const { diagnostics } = collect(
      bundle({ kind: "text", id: "t", style: { fontFamily: "Noto Sans CJK SC" } }),
    );
    expect(diagnostics).toHaveLength(0);
    const out = compileBundle(
      bundle({ kind: "text", id: "t", style: { fontFamily: "Noto Sans CJK SC" } }),
    );
    expect(out.root.props?.font).toBe("Noto Sans CJK SC");
  });

  it("fontFamily: injection string compiles without warn (compiler does not validate shape)", () => {
    // Compiler passes it through; runtime will reject it later.
    const { diagnostics } = collect(
      bundle({ kind: "text", id: "t", style: { fontFamily: "Inter; } body { color: red" } }),
    );
    expect(diagnostics).toHaveLength(0);
  });
});

// ─── F. Two sibling nodes: same unknown key warns twice (no cross-node dedup) ─

describe("F — independent per-node warnings (no cross-node dedup)", () => {
  it("two text nodes with the same unknown key each warn independently", () => {
    const { diagnostics } = collect(
      bundle({
        kind: "stack",
        id: "root",
        children: [
          { kind: "text", id: "t1", unknownKey: 1 } as unknown as LSMLNode,
          { kind: "text", id: "t2", unknownKey: 2 } as unknown as LSMLNode,
        ],
      }),
    );
    const matches = diagnostics.filter((d) => d.field === "unknownKey");
    expect(matches).toHaveLength(2);
    expect(matches.map((d) => d.nodeId).sort()).toEqual(["t1", "t2"]);
  });

  it("100 siblings with the same unknown key → 100 warnings (one per node object)", () => {
    const children = Array.from({ length: 100 }, (_, i) => ({
      kind: "text",
      id: `t${i}`,
      weirdProp: i,
    })) as unknown as LSMLNode[];
    const { diagnostics } = collect(
      bundle({ kind: "stack", id: "root", children }),
    );
    const matches = diagnostics.filter((d) => d.field === "weirdProp");
    expect(matches).toHaveLength(100);
    // The prop value (i = 0..99) must not appear as a standalone JSON value.
    // Node IDs like "t0" are structural; we check no bare numeric value appears
    // as a JSON value entry (the diagnostic fields are all strings).
    const parsed = JSON.parse(JSON.stringify(diagnostics)) as Record<string, unknown>[];
    for (const d of parsed) {
      // Only nodeId, field, reason should be keys.
      expect(Object.keys(d).sort()).toEqual(["field", "nodeId", "reason"]);
    }
  });

  it("the 100-sibling loop does not carry any value in the diagnostics", () => {
    const children = Array.from({ length: 10 }, (_, i) => ({
      kind: "text",
      id: `nt${i}`,
      secret: SENTINEL,
    })) as unknown as LSMLNode[];
    const { diagnostics } = collect(
      bundle({ kind: "stack", id: "root", children }),
    );
    expect(JSON.stringify(diagnostics)).not.toContain(SENTINEL);
  });
});
