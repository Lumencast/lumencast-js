// Issue #34 — anti-silent-drop diagnostics, runtime half (ADR 001 §3.4
// D4, §5.1 R9, §6 RC#7).
//
// Covered here :
//   A. structured diagnostics channel — handler receives
//      { nodeId, field, reason } ; console fallback only when no handler
//   B. per-primitive prop allowlists — unknown prop (static or binding
//      key) diagnoses with node.id + field, once per node ; known props
//      stay silent
//   C. node.id plumbing — every existing rejection diagnostic
//      (colour / typography / clipsContent / path / fills) names the
//      owning node (RC#7)
//   D. defence-in-depth typo caps (Bastion follow-up on PR #38) —
//      letterSpacing / lineHeight boundaries (maxLines boundaries live
//      in text-typography-probe.test.tsx)
//   E. fontFamily shape validation — legitimate family lists pass,
//      malformed strings are rejected with a diagnostic and never reach
//      inline CSS
//
// The R9 hygiene proof (no value in any diagnostic, ever) lives in
// r9-sentinel.test.tsx.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { Tree } from "../../src/render/tree.js";
import {
  addDiagnosticsHandler,
  emitDiagnostic,
  ANON_NODE_ID,
  type RenderDiagnostic,
} from "../../src/render/diagnostics.js";
import { checkNodeProps, PRIMITIVE_PROP_ALLOWLIST } from "../../src/render/prop-allowlist.js";
import {
  parseFontFamily,
  resolveTypography,
  MAX_LETTER_SPACING_PX,
  MAX_LINE_HEIGHT,
} from "../../src/render/primitives/text.js";
import { createStore, type Store } from "../../src/state/store.js";
import type { RenderNode } from "../../src/render/bundle.js";

let container: HTMLDivElement;
let root: Root;
let warnSpy: ReturnType<typeof vi.spyOn>;
let diagnostics: RenderDiagnostic[];
let removeHandler: (() => void) | undefined;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  diagnostics = [];
});

afterEach(async () => {
  removeHandler?.();
  removeHandler = undefined;
  await act(async () => root.unmount());
  container.remove();
  warnSpy.mockRestore();
});

function capture(): void {
  removeHandler = addDiagnosticsHandler((d) => diagnostics.push(d));
}

async function render(node: RenderNode, store: Store = createStore()): Promise<void> {
  await act(async () => {
    root.render(<Tree node={node} store={store} />);
  });
}

function fields(): string[] {
  return diagnostics.map((d) => d.field);
}

// ─── A. structured channel ────────────────────────────────────────────

describe("A — diagnostics channel", () => {
  it("handler receives { nodeId, field, reason } ; console stays silent", () => {
    capture();
    emitDiagnostic("n1", "text.colour", "rejected");
    expect(diagnostics).toEqual([{ nodeId: "n1", field: "text.colour", reason: "rejected" }]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("anonymous nodes report ANON_NODE_ID", () => {
    capture();
    emitDiagnostic(undefined, "f", "r");
    expect(diagnostics[0]!.nodeId).toBe(ANON_NODE_ID);
  });

  it("no handler → DEV console.warn fallback fires", () => {
    emitDiagnostic("n1", "text.colour", "rejected");
    expect(warnSpy).toHaveBeenCalledOnce();
    const msg = String(warnSpy.mock.calls[0]![0]);
    expect(msg).toContain("n1");
    expect(msg).toContain("text.colour");
  });

  it("a throwing host handler never breaks emission", () => {
    const remove = addDiagnosticsHandler(() => {
      throw new Error("host bug");
    });
    capture();
    expect(() => emitDiagnostic("n1", "f", "r")).not.toThrow();
    expect(diagnostics).toHaveLength(1);
    remove();
  });

  it("unregistering stops delivery", () => {
    capture();
    removeHandler!();
    removeHandler = undefined;
    emitDiagnostic("n1", "f", "r");
    expect(diagnostics).toHaveLength(0);
  });
});

// ─── B. prop allowlists ───────────────────────────────────────────────

describe("B — per-primitive prop allowlists", () => {
  it("every primitive kind declares an allowlist", () => {
    for (const kind of [
      "stack",
      "grid",
      "frame",
      "text",
      "image",
      "shape",
      "media",
      "instance",
      "repeat",
    ] as const) {
      expect(PRIMITIVE_PROP_ALLOWLIST[kind]).toBeInstanceOf(Set);
    }
  });

  it("unknown static prop → diagnostic with node.id + kind-qualified field", async () => {
    capture();
    await render({ kind: "text", id: "t1", props: { value: "hi", glow: 4 } });
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ nodeId: "t1", field: "text.glow" }),
    );
    // The known props stay silent.
    expect(fields()).not.toContain("text.value");
  });

  it("unknown binding key → diagnostic too (bindings resolve to props)", async () => {
    capture();
    const store = createStore();
    store.set("x.y", 1);
    await render({ kind: "frame", id: "f1", bindings: { sparkle: "x.y" } }, store);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ nodeId: "f1", field: "frame.sparkle" }),
    );
  });

  it("diagnoses once per node object (dedup across re-renders)", () => {
    capture();
    const node: RenderNode = { kind: "text", id: "t1", props: { glow: 1 } };
    checkNodeProps(node);
    checkNodeProps(node);
    expect(fields().filter((f) => f === "text.glow")).toHaveLength(1);
  });

  it("fully-known compiled props are silent (text / frame / shape smoke)", async () => {
    capture();
    await render({
      kind: "frame",
      id: "f",
      props: { width: 100, height: 50, background: "#fff", clipsContent: true },
      children: [
        { kind: "text", id: "t", props: { value: "x", size: 12, colour: "red", maxLines: 2 } },
        { kind: "shape", id: "s", props: { geometry: "rect", fill: "#000", radius: 2 } },
      ],
    });
    expect(diagnostics).toHaveLength(0);
  });

  it("universal props (§5.4) are allowed on every primitive", async () => {
    capture();
    await render({
      kind: "text",
      id: "t",
      props: { value: "x", visible: true, opacity: 0.5, rotation: 10, sizing: { x: "fill" } },
    });
    expect(diagnostics).toHaveLength(0);
  });

  it("repeat allows its items binding ; instance allows params.*", async () => {
    capture();
    const store = createStore();
    store.set("rows", [1]);
    await render({
      kind: "repeat",
      id: "r",
      bindings: { items: "rows" },
      children: [{ kind: "text", id: "tpl", props: { value: "x" } }],
    });
    checkNodeProps({
      kind: "instance",
      id: "i",
      props: { scene_id: "s", scene_version: "v", params: {} },
      bindings: { "params.score": "leaf" },
    });
    expect(fields()).not.toContain("repeat.items");
    expect(fields()).not.toContain("instance.params.score");
    expect(fields()).not.toContain("instance.params");
  });

  it("known drops are diagnosed : compiler-emitted media.muted / grid.columns / text.format", () => {
    capture();
    checkNodeProps({ kind: "media", id: "m", props: { muted: true } });
    checkNodeProps({ kind: "grid", id: "g", props: { columns: 3 } });
    checkNodeProps({ kind: "text", id: "t", props: { format: { kind: "number" } } });
    expect(fields()).toEqual(
      expect.arrayContaining(["media.muted", "grid.columns", "text.format"]),
    );
  });

  it("angular/diamond gradient fill entries drop WITH a diagnostic (1.2 gap)", async () => {
    capture();
    await render({
      kind: "shape",
      id: "grad",
      props: {
        geometry: "rect",
        fills: [
          { kind: "angular-gradient", stops: [{ offset: 0, color: "#fff" }] },
          { kind: "solid", color: "#000" },
        ],
      },
    });
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ nodeId: "grad", field: "shape.fills.kind" }),
    );
    // The renderable layer still renders.
    expect(container.querySelector("rect")).not.toBeNull();
  });

  it("unknown render kind diagnoses instead of console-logging", async () => {
    capture();
    await render({ kind: "hologram", id: "h" } as unknown as RenderNode);
    expect(diagnostics).toContainEqual(expect.objectContaining({ nodeId: "h", field: "kind" }));
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ─── C. node.id plumbing into existing rejection diagnostics (RC#7) ───

describe("C — node.id reaches every rejection diagnostic", () => {
  it("text.colour rejection names the node", async () => {
    capture();
    await render({ kind: "text", id: "score-label", props: { value: "x", colour: "url(x)" } });
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ nodeId: "score-label", field: "text.colour" }),
    );
  });

  it("typography rejection names the node", async () => {
    capture();
    await render({ kind: "text", id: "t9", props: { value: "x", textTransform: "blink" } });
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ nodeId: "t9", field: "text.textTransform" }),
    );
  });

  it("frame.clipsContent + frame.background rejections name the node", async () => {
    capture();
    await render({
      kind: "frame",
      id: "fx",
      props: { clipsContent: "nope", background: "u r l (x)" },
    });
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ nodeId: "fx", field: "frame.clipsContent" }),
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ nodeId: "fx", field: "frame.background" }),
    );
  });

  it("shape path + fill rejections name the node", async () => {
    capture();
    await render({
      kind: "shape",
      id: "sx",
      props: {
        geometry: "path",
        pathData: "M 0 0 <script>",
        fill: "evil;",
        fills: [{ kind: "solid", color: "bad;" }],
      },
    });
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ nodeId: "sx", field: "shape.pathData" }),
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ nodeId: "sx", field: "shape.fill" }),
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ nodeId: "sx", field: "shape.fills.color" }),
    );
  });

  it("live-delta rejection still names the node (wire-driven prop)", async () => {
    capture();
    const store = createStore();
    store.set("c", "#fff");
    await render(
      { kind: "text", id: "live", props: { value: "x" }, bindings: { colour: "c" } },
      store,
    );
    expect(fields()).not.toContain("text.colour");
    await act(async () => {
      store.set("c", "red; } body { background: url(http://evil)");
    });
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ nodeId: "live", field: "text.colour" }),
    );
  });
});

// ─── D. defence-in-depth typo caps (issue #34) ────────────────────────

describe("D — typo caps : reject above bound, accept at bound", () => {
  it("letterSpacing accepts ±MAX_LETTER_SPACING_PX, rejects beyond", () => {
    capture();
    expect(resolveTypography({ letterSpacing: MAX_LETTER_SPACING_PX }).letterSpacing).toBe(
      `${MAX_LETTER_SPACING_PX}px`,
    );
    expect(resolveTypography({ letterSpacing: -MAX_LETTER_SPACING_PX }).letterSpacing).toBe(
      `-${MAX_LETTER_SPACING_PX}px`,
    );
    expect(diagnostics).toHaveLength(0);
    expect(
      resolveTypography({ letterSpacing: MAX_LETTER_SPACING_PX + 1 }, "n").letterSpacing,
    ).toBeUndefined();
    expect(
      resolveTypography({ letterSpacing: -(MAX_LETTER_SPACING_PX + 1) }, "n").letterSpacing,
    ).toBeUndefined();
    expect(fields().filter((f) => f === "text.letterSpacing")).toHaveLength(2);
    expect(diagnostics.every((d) => d.nodeId === "n")).toBe(true);
  });

  it("lineHeight rejects above MAX_LINE_HEIGHT with node id", () => {
    capture();
    expect(
      resolveTypography({ lineHeight: MAX_LINE_HEIGHT + 0.5 }, "lh").lineHeight,
    ).toBeUndefined();
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ nodeId: "lh", field: "text.lineHeight" }),
    );
  });
});

// ─── E. fontFamily shape validation (issue #34) ───────────────────────

describe("E — fontFamily : shape validation, not an allowlist", () => {
  it.each([
    "Inter",
    "Bebas Neue",
    "Inter, 'Helvetica Neue', sans-serif",
    '"JetBrains Mono", monospace',
    "Noto Sans CJK, sans-serif",
  ])("legitimate family list %j passes", (family) => {
    expect(parseFontFamily(family)).toBe(family);
  });

  it.each([
    "Inter; } body { background: url(http://evil)",
    "url(http://evil)",
    "Inter\\9",
    "font</style>",
    "{Inter}",
    "",
    "   ",
    "x".repeat(257),
  ])("malformed %j is rejected", (family) => {
    expect(parseFontFamily(family)).toBeNull();
  });

  it("rejected font emits a diagnostic and never reaches inline CSS", async () => {
    capture();
    await render({
      kind: "text",
      id: "ft",
      props: { value: "x", font: "Inter; } body { background: url(http://evil)" },
    });
    const span = container.querySelector("span")!;
    expect(span.getAttribute("style") ?? "").not.toContain("evil");
    expect(span.style.fontFamily).toBe("");
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ nodeId: "ft", field: "text.font" }),
    );
  });

  it("accepted font renders (regression)", async () => {
    capture();
    await render({ kind: "text", id: "ft2", props: { value: "x", font: "Bebas Neue" } });
    const span = container.querySelector("span")!;
    expect(span.style.fontFamily).toContain("Bebas Neue");
    expect(fields()).not.toContain("text.font");
  });
});
