// Typed mask render — ADR 002 §3.2 (#E) ; Bastion T1/T2/T3/T4.
//
// The compiler lowers a typed `mask` onto a node (`props.mask`) ; this is the
// runtime half : the Tree builds a real `<mask>` SVG element from those typed
// fields and applies `mask: url(#…)` to a wrapping div. Proof layers :
//
//   1. alpha vs luminance → `mask-type` on the emitted `<mask>` (T4 switch).
//   2. boolean ops (intersect / subtract / union) → distinct fixed structure.
//   3. T3 — a `mask.source` smuggling `<script>` / `<foreignObject>` produces
//      NO executable element : the markup lands as a plain `href` string or is
//      rejected, never parsed as DOM ; no `dangerouslySetInnerHTML` on the path.
//   4. T1/T2 — an image source off the allowlist (or a non-https scheme) is
//      rejected before any `href` ; the mask is omitted.
//   5. T4 — `mask.type` / `mask.op` outside the closed enum → omitted.
//   6. R9 — no diagnostic carries the rejected URL.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";

import { Tree } from "../../src/render/tree.js";
import { AllowedHostsProvider } from "../../src/render/allowed-hosts.js";
import { ShapeIndexProvider, buildShapeIndex } from "../../src/render/shape-index.js";
import { addDiagnosticsHandler, type RenderDiagnostic } from "../../src/render/diagnostics.js";
import { createStore } from "../../src/state/store.js";
import { buildMask, parseMaskSpec, type MaskSpec } from "../../src/render/mask.js";
import type { RenderNode } from "../../src/render/bundle.js";

let container: HTMLDivElement;
let root: Root;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let diagnostics: RenderDiagnostic[];
let removeHandler: () => void;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  diagnostics = [];
  removeHandler = addDiagnosticsHandler((d) => diagnostics.push(d));
});

afterEach(async () => {
  removeHandler();
  await act(async () => root.unmount());
  container.remove();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

/** Indexed shapes a shape-source mask can reference (#K). The masked node and
 *  these referenced shapes are siblings under a frame so the one-pass index
 *  picks them up exactly as it would in a real bundle. */
const REFERENCEABLE: RenderNode[] = [
  { kind: "shape", id: "ellipse-9", props: { geometry: "circle", width: 80, height: 80 } },
  { kind: "shape", id: "src1", props: { geometry: "rect", width: 40, height: 40 } },
];

async function render(node: RenderNode, wrap?: (t: ReactNode) => ReactNode): Promise<void> {
  const store = createStore();
  // #K — the mask resolves shape refs against the bundle-wide index. Wrap the
  // masked node + the referenceable shapes under a root and index that root.
  const treeRoot: RenderNode = {
    kind: "frame",
    id: "root",
    props: { width: 200, height: 200 },
    children: [node, ...REFERENCEABLE],
  };
  const index = buildShapeIndex(treeRoot);
  const tree = (
    <ShapeIndexProvider index={index}>
      <Tree node={treeRoot} store={store} />
    </ShapeIndexProvider>
  );
  await act(async () => {
    root.render(wrap ? wrap(tree) : tree);
  });
}

const SHAPE_BASE = (mask: unknown): RenderNode => ({
  kind: "shape",
  id: "masked-1",
  props: { geometry: "rect", width: 100, height: 100, mask },
});

describe("mask render — alpha/luminance + boolean ops (#K inlined geometry)", () => {
  it("luminance/intersect inlines the resolved shape geometry (no <use>)", async () => {
    await render(
      SHAPE_BASE({
        source: { kind: "shape", ref: "ellipse-9" },
        type: "luminance",
        op: "intersect",
      }),
    );
    const maskEl = container.querySelector("mask");
    expect(maskEl).not.toBeNull();
    // luminance is the SVG default → no explicit mask-type attribute.
    expect(maskEl?.getAttribute("mask-type")).toBeNull();
    // The wrapping div references the mask by url(#id).
    const id = maskEl?.getAttribute("id");
    expect(id).toBeTruthy();
    expect(container.querySelector(`div[style*="${id}"]`)).not.toBeNull();
    // #K — the dangling `<use href>` is GONE ; the referenced shape's geometry
    // (ellipse-9 = circle) is inlined as white coverage paint.
    expect(maskEl?.querySelector("use")).toBeNull();
    const circle = maskEl?.querySelector("circle");
    expect(circle).not.toBeNull();
    expect(circle?.getAttribute("fill")).toBe("white");
    // intersect → no full-coverage base rect.
    expect(maskEl?.querySelectorAll("rect").length).toBe(0);
  });

  it("a rect-geometry ref inlines a <rect> coverage element", async () => {
    await render(
      SHAPE_BASE({ source: { kind: "shape", ref: "src1" }, type: "luminance", op: "intersect" }),
    );
    const maskEl = container.querySelector("mask");
    expect(maskEl?.querySelector("use")).toBeNull();
    expect(maskEl?.querySelector("rect")?.getAttribute("fill")).toBe("white");
  });

  it("alpha type sets mask-type:alpha on the <mask> (T4 typed switch)", async () => {
    await render(
      SHAPE_BASE({ source: { kind: "shape", ref: "src1" }, type: "alpha", op: "intersect" }),
    );
    expect(container.querySelector("mask")?.getAttribute("mask-type")).toBe("alpha");
  });

  it("union adds a full-coverage base rect, subtract carves it out", async () => {
    await render(
      SHAPE_BASE({ source: { kind: "shape", ref: "ellipse-9" }, type: "luminance", op: "union" }),
    );
    let maskEl = container.querySelector("mask");
    // union : one full-coverage base rect + the inlined circle geometry.
    expect(maskEl?.querySelectorAll("rect").length).toBe(1);
    expect(maskEl?.querySelector("circle")).not.toBeNull();
    expect(maskEl?.querySelector("use")).toBeNull();

    await act(async () => root.unmount());
    root = createRoot(container);
    await render(
      SHAPE_BASE({
        source: { kind: "shape", ref: "ellipse-9" },
        type: "luminance",
        op: "subtract",
      }),
    );
    maskEl = container.querySelector("mask");
    expect(maskEl?.querySelectorAll("rect").length).toBe(1);
    // subtract wraps the inlined source paint to carve it out.
    expect(maskEl?.querySelector("circle")).not.toBeNull();
    expect(maskEl?.querySelector("use")).toBeNull();
  });

  it("position offsets the inlined geometry numerically (typed translate)", async () => {
    await render(
      SHAPE_BASE({
        source: { kind: "shape", ref: "ellipse-9" },
        type: "luminance",
        op: "intersect",
        position: { x: 5, y: 7 },
      }),
    );
    // The inlined geometry is wrapped in a translated group ; numbers only.
    const g = container.querySelector("mask g[transform]");
    expect(g?.getAttribute("transform")).toBe("translate(5 7)");
    expect(g?.querySelector("circle")).not.toBeNull();
  });
});

describe("mask render — shape ref resolution (#K invariants)", () => {
  it("a PENDING ref (id not in the index) omits the mask without crashing", async () => {
    await render(
      SHAPE_BASE({
        source: { kind: "shape", ref: "does-not-exist" },
        type: "luminance",
        op: "intersect",
      }),
    );
    // No mask element ; the masked subtree still renders (unmasked).
    expect(container.querySelector("mask")).toBeNull();
    expect(container.querySelector('svg[viewBox="0 0 100 100"]')).not.toBeNull();
    expect(diagnostics.some((d) => d.field === "mask.source.ref")).toBe(true);
  });

  it("anti-cycle : a shape that itself carries a mask contributes only its geometry (depth=1)", async () => {
    // src1 is referenced ; here we make the masked node reference a shape that
    // ALSO carries its own mask. The resolver inlines ONLY the geometry of the
    // referenced shape, never re-entering the mask builder → no recursion.
    const root2: RenderNode = {
      kind: "frame",
      id: "root",
      props: { width: 200, height: 200 },
      children: [
        {
          kind: "shape",
          id: "masked-1",
          props: {
            geometry: "rect",
            width: 100,
            height: 100,
            mask: { source: { kind: "shape", ref: "carrier" }, type: "luminance", op: "intersect" },
          },
        },
        {
          // The referenced shape carries its OWN mask referencing back the
          // masked node — a `mask → shape → mask → …` cycle. Must NOT recurse.
          kind: "shape",
          id: "carrier",
          props: {
            geometry: "circle",
            width: 60,
            height: 60,
            mask: {
              source: { kind: "shape", ref: "masked-1" },
              type: "luminance",
              op: "intersect",
            },
          },
        },
      ],
    };
    const store = createStore();
    const index = buildShapeIndex(root2);
    await act(async () => {
      root.render(
        <ShapeIndexProvider index={index}>
          <Tree node={root2} store={store} />
        </ShapeIndexProvider>,
      );
    });
    // Exactly two masks exist (one per masked shape) ; neither nests the other.
    const masks = container.querySelectorAll("mask");
    expect(masks.length).toBe(2);
    masks.forEach((m) => {
      // A mask inlines geometry only — never a nested <mask> (depth=1).
      expect(m.querySelector("mask")).toBeNull();
      expect(m.querySelector("use")).toBeNull();
    });
  });

  it("a duplicate shape id is diagnosed ; the first occurrence is kept", async () => {
    const root3: RenderNode = {
      kind: "frame",
      id: "root",
      props: { width: 200, height: 200 },
      children: [
        { kind: "shape", id: "dup", props: { geometry: "circle", width: 10, height: 10 } },
        { kind: "shape", id: "dup", props: { geometry: "rect", width: 20, height: 20 } },
        {
          kind: "shape",
          id: "masked-1",
          props: {
            geometry: "rect",
            width: 100,
            height: 100,
            mask: { source: { kind: "shape", ref: "dup" }, type: "luminance", op: "intersect" },
          },
        },
      ],
    };
    const store = createStore();
    const index = buildShapeIndex(root3);
    await act(async () => {
      root.render(
        <ShapeIndexProvider index={index}>
          <Tree node={root3} store={store} />
        </ShapeIndexProvider>,
      );
    });
    // The collision is diagnosed.
    expect(diagnostics.some((d) => d.field === "id")).toBe(true);
    // First occurrence (circle) wins → the mask inlines a circle, not a rect.
    const maskEl = container.querySelector("mask");
    expect(maskEl?.querySelector("circle")).not.toBeNull();
  });
});

describe("mask render — image source host gate (T1/T2)", () => {
  const ALLOWED = ["cdn.example.com"];

  it("an allowed https image source reaches the <image href>", async () => {
    await render(
      SHAPE_BASE({
        source: { kind: "image", src: "https://cdn.example.com/m.png" },
        type: "alpha",
        op: "intersect",
      }),
      (t) => <AllowedHostsProvider hosts={ALLOWED}>{t}</AllowedHostsProvider>,
    );
    expect(container.querySelector("mask image")?.getAttribute("href")).toBe(
      "https://cdn.example.com/m.png",
    );
  });

  it("an off-allowlist host is rejected ; no <image>, mask omitted, no leak", async () => {
    await render(
      SHAPE_BASE({
        source: { kind: "image", src: "https://evil.example.org/secret.png" },
        type: "alpha",
        op: "intersect",
      }),
      (t) => <AllowedHostsProvider hosts={ALLOWED}>{t}</AllowedHostsProvider>,
    );
    expect(container.querySelector("mask")).toBeNull();
    expect(container.querySelector("image")).toBeNull();
    expect(diagnostics.some((d) => d.field === "mask.source.src")).toBe(true);
    // R9 — the rejected URL never transits the diagnostic channel.
    const output = [JSON.stringify(diagnostics), ...warnSpy.mock.calls.flat().map(String)].join(
      " ",
    );
    expect(output).not.toContain("evil.example.org");
    expect(output).not.toContain("secret.png");
  });

  it("a non-https scheme (javascript:) is rejected, no fetch/href emitted", async () => {
    await render(
      SHAPE_BASE({
        source: { kind: "image", src: "javascript:alert(1)//cdn.example.com" },
        type: "alpha",
        op: "intersect",
      }),
      (t) => <AllowedHostsProvider hosts={ALLOWED}>{t}</AllowedHostsProvider>,
    );
    expect(container.querySelector("mask")).toBeNull();
    expect(container.querySelector("image")).toBeNull();
  });

  it("with NO provider, a remote host is denied by default", async () => {
    await render(
      SHAPE_BASE({
        source: { kind: "image", src: "https://cdn.example.com/m.png" },
        type: "alpha",
        op: "intersect",
      }),
    );
    expect(container.querySelector("mask")).toBeNull();
  });
});

describe("mask render — T3 no executable markup from the bundle", () => {
  it("a <script> smuggled as a shape ref produces no executable element", async () => {
    await render(
      SHAPE_BASE({
        source: { kind: "shape", ref: '"><script>alert(1)</script>' },
        type: "luminance",
        op: "intersect",
      }),
    );
    // The ref is not a safe id token → mask omitted, nothing in the DOM.
    expect(container.querySelector("mask")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("foreignObject")).toBeNull();
    expect(diagnostics.some((d) => d.field === "mask.source.ref")).toBe(true);
  });

  it("a <foreignObject>/markup image src never becomes DOM markup", async () => {
    await render(
      SHAPE_BASE({
        source: {
          kind: "image",
          src: 'https://cdn.example.com/x"><foreignObject><script>alert(1)</script>',
        },
        type: "alpha",
        op: "intersect",
      }),
      (t) => <AllowedHostsProvider hosts={["cdn.example.com"]}>{t}</AllowedHostsProvider>,
    );
    // Even if the URL parsed, the malicious tail is part of the href STRING,
    // never parsed as markup : no script / foreignObject element exists.
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("foreignObject")).toBeNull();
    const img = container.querySelector("mask image");
    // The src carries `cdn.example.com` host → host-allowed ; href is a string.
    if (img) expect(img.getAttribute("href")).not.toBeNull();
  });

  it("no dangerouslySetInnerHTML / innerHTML on the mask path (static, #K)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    // The whole mask path is markup-free : the builder, the shared geometry
    // builder it inlines, and the index that resolves the ref (T3, A2.4).
    for (const rel of [
      "src/render/mask.tsx",
      "src/render/shape-geometry.tsx",
      "src/render/shape-index.tsx",
    ]) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src).not.toContain("dangerouslySetInnerHTML");
      expect(src).not.toContain("innerHTML");
    }
  });
});

describe("mask render — closed-enum gate (T4)", () => {
  it("out-of-enum mask.type → diagnostic + omission, no <mask>", async () => {
    await render(
      SHAPE_BASE({ source: { kind: "shape", ref: "s" }, type: "rainbow", op: "intersect" }),
    );
    expect(container.querySelector("mask")).toBeNull();
    expect(diagnostics.some((d) => d.field === "mask.type")).toBe(true);
  });

  it("out-of-enum mask.op → diagnostic + omission, no <mask>", async () => {
    await render(SHAPE_BASE({ source: { kind: "shape", ref: "s" }, type: "alpha", op: "xor" }));
    expect(container.querySelector("mask")).toBeNull();
    expect(diagnostics.some((d) => d.field === "mask.op")).toBe(true);
  });

  it("a malformed source discriminant → omission", async () => {
    await render(SHAPE_BASE({ source: { kind: "video", src: "x" }, type: "alpha", op: "union" }));
    expect(container.querySelector("mask")).toBeNull();
    expect(diagnostics.some((d) => d.field === "mask.source")).toBe(true);
  });
});

describe("parseMaskSpec / buildMask — pure helpers", () => {
  it("parseMaskSpec rejects non-object and bad enums without throwing", () => {
    expect(parseMaskSpec(null, "n")).toBeNull();
    expect(parseMaskSpec("nope", "n")).toBeNull();
    expect(
      parseMaskSpec({ source: { kind: "shape", ref: "s" }, type: "x", op: "union" }, "n"),
    ).toBeNull();
  });

  it("buildMask re-validates the enum even if called directly (defence in depth)", () => {
    const bad = {
      source: { kind: "shape", ref: "s" },
      type: "bad",
      op: "union",
    } as unknown as MaskSpec;
    expect(buildMask(bad, undefined, "n")).toBeNull();
  });
});
