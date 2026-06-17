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

async function render(node: RenderNode, wrap?: (t: ReactNode) => ReactNode): Promise<void> {
  const store = createStore();
  const tree = <Tree node={node} store={store} />;
  await act(async () => {
    root.render(wrap ? wrap(tree) : tree);
  });
}

const SHAPE_BASE = (mask: unknown): RenderNode => ({
  kind: "shape",
  id: "masked-1",
  props: { geometry: "rect", width: 100, height: 100, mask },
});

describe("mask render — alpha/luminance + boolean ops", () => {
  it("luminance/intersect emits a <mask> referenced by the wrapper", async () => {
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
    const wrapper = container.querySelector(`div[style*="${id}"]`);
    expect(wrapper).not.toBeNull();
    // intersect → a single <use>, no full-coverage base rect.
    expect(maskEl?.querySelectorAll("rect").length).toBe(0);
    expect(maskEl?.querySelector("use")?.getAttribute("href")).toBe("#ellipse-9");
  });

  it("alpha type sets mask-type:alpha on the <mask> (T4 typed switch)", async () => {
    await render(
      SHAPE_BASE({ source: { kind: "shape", ref: "src1" }, type: "alpha", op: "intersect" }),
    );
    expect(container.querySelector("mask")?.getAttribute("mask-type")).toBe("alpha");
  });

  it("union adds a full-coverage base rect, subtract carves it out", async () => {
    await render(
      SHAPE_BASE({ source: { kind: "shape", ref: "src1" }, type: "luminance", op: "union" }),
    );
    let maskEl = container.querySelector("mask");
    expect(maskEl?.querySelectorAll("rect").length).toBe(1);
    expect(maskEl?.querySelector("use")).not.toBeNull();

    await act(async () => root.unmount());
    root = createRoot(container);
    await render(
      SHAPE_BASE({ source: { kind: "shape", ref: "src1" }, type: "luminance", op: "subtract" }),
    );
    maskEl = container.querySelector("mask");
    expect(maskEl?.querySelectorAll("rect").length).toBe(1);
    // subtract wraps the source paint to carve it out.
    expect(maskEl?.querySelector("use")).not.toBeNull();
  });

  it("position/size place the mask source numerically", async () => {
    await render(
      SHAPE_BASE({
        source: { kind: "shape", ref: "src1" },
        type: "luminance",
        op: "intersect",
        position: { x: 5, y: 7 },
        size: { w: 30, h: 40 },
      }),
    );
    const use = container.querySelector("mask use");
    expect(use?.getAttribute("x")).toBe("5");
    expect(use?.getAttribute("y")).toBe("7");
    expect(use?.getAttribute("width")).toBe("30");
    expect(use?.getAttribute("height")).toBe("40");
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
      (t) => <AllowedHostsProvider allowedHosts={ALLOWED}>{t}</AllowedHostsProvider>,
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
      (t) => <AllowedHostsProvider allowedHosts={ALLOWED}>{t}</AllowedHostsProvider>,
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
      (t) => <AllowedHostsProvider allowedHosts={ALLOWED}>{t}</AllowedHostsProvider>,
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
      (t) => <AllowedHostsProvider allowedHosts={["cdn.example.com"]}>{t}</AllowedHostsProvider>,
    );
    // Even if the URL parsed, the malicious tail is part of the href STRING,
    // never parsed as markup : no script / foreignObject element exists.
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("foreignObject")).toBeNull();
    const img = container.querySelector("mask image");
    // The src carries `cdn.example.com` host → host-allowed ; href is a string.
    if (img) expect(img.getAttribute("href")).not.toBeNull();
  });

  it("no dangerouslySetInnerHTML / innerHTML in the mask source module (static)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "src/render/mask.tsx"), "utf8");
    expect(src).not.toContain("dangerouslySetInnerHTML");
    expect(src).not.toContain("innerHTML");
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
