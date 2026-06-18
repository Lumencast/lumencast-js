// LSML 1.2 render integration — ADR 002 #D + #E + #F together.
//
// The three render features land on independent branches ; this proves they
// COEXIST on a single render tree without one clobbering another, and that
// the ONE unified host-allowlist provider (`allowed-hosts.tsx`, reconciled
// from #E + #F) governs BOTH gated surfaces at once :
//
//   - #D  blendMode  → `mix-blend-mode` on the universal wrapper,
//   - #E  mask       → a typed `<mask>` SVG element + `mask:url(#…)`,
//   - #F  image-fill → `background-image:url(...)` gated by the same provider.
//
// Single-provider invariant : a frame carrying a blendMode AND a mask AND an
// image-fill background renders all three when the fill host is allowlisted,
// and the SAME provider that admits the image-fill also admits a mask-image
// source (one allowlist, no second context). Deny-by-default still holds : an
// off-allowlist image-fill is dropped while blendMode + mask survive.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";

import { Tree } from "../../src/render/tree.js";
import { AllowedHostsProvider } from "../../src/render/allowed-hosts.js";
import { ShapeIndexProvider, buildShapeIndex } from "../../src/render/shape-index.js";
import { addDiagnosticsHandler, type RenderDiagnostic } from "../../src/render/diagnostics.js";
import { createStore } from "../../src/state/store.js";
import type { RenderNode } from "../../src/render/bundle.js";

const ALLOWED = ["cdn.example.com"] as const;
const GOOD = "https://cdn.example.com/bg.png";
const BAD = "https://evil.example.org/bg.png";

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
  // #K — the shape-source mask resolves its ref against the bundle-wide index ;
  // build it from the rendered root so `ellipse-9` is resolvable.
  const index = buildShapeIndex(node);
  const tree = (
    <ShapeIndexProvider index={index}>
      <Tree node={node} store={store} />
    </ShapeIndexProvider>
  );
  await act(async () => {
    root.render(wrap ? wrap(tree) : tree);
  });
}

const withHosts =
  (hosts: readonly string[] | undefined) =>
  (t: ReactNode): ReactNode => <AllowedHostsProvider hosts={hosts}>{t}</AllowedHostsProvider>;

/** A frame carrying all three 1.2 render features at once. */
const TRIPLE = (src: string): RenderNode => ({
  kind: "frame",
  id: "triple-1",
  props: {
    width: 100,
    height: 100,
    blendMode: "multiply",
    mask: { source: { kind: "shape", ref: "ellipse-9" }, type: "alpha", op: "intersect" },
    backgrounds: [{ kind: "image", src, objectFit: "cover" }],
  },
  // #K — the shape the mask references is a real indexed shape in the bundle.
  children: [
    { kind: "shape", id: "ellipse-9", props: { geometry: "circle", width: 80, height: 80 } },
  ],
});

describe("LSML 1.2 render integration — blendMode + mask + image-fill coexist", () => {
  it("all three features render together when the fill host is allowlisted", async () => {
    await render(TRIPLE(GOOD), withHosts(ALLOWED));

    // #D — blendMode reaches mix-blend-mode on the wrapper.
    const blended = container.querySelector('[style*="mix-blend-mode"]');
    expect(blended).not.toBeNull();
    expect(blended?.getAttribute("style")).toContain("multiply");

    // #E — a typed <mask> element exists and is referenced by url(#id).
    const maskEl = container.querySelector("mask");
    expect(maskEl).not.toBeNull();
    expect(maskEl?.getAttribute("mask-type")).toBe("alpha");
    const maskId = maskEl?.getAttribute("id");
    expect(maskId).toBeTruthy();
    expect(container.querySelector(`div[style*="${maskId}"]`)).not.toBeNull();

    // #F — the allowlisted image-fill reaches background-image with the URL.
    const withBg = Array.from(container.querySelectorAll("div")).find((d) =>
      (d.getAttribute("style") ?? "").includes("background-image"),
    );
    expect(withBg).toBeTruthy();
    expect(withBg?.getAttribute("style")).toContain(GOOD);

    // No spurious host-gate diagnostic for the allowed src.
    expect(diagnostics.some((d) => d.field === "frame.backgrounds.src")).toBe(false);
  });

  it("the single provider denies an off-allowlist image-fill while blendMode + mask survive", async () => {
    await render(TRIPLE(BAD), withHosts(ALLOWED));

    // #F — the off-allowlist src is dropped : no URL anywhere in the DOM.
    expect(container.innerHTML).not.toContain("evil.example.org");
    const anyBg = Array.from(container.querySelectorAll("div")).some((d) =>
      (d.getAttribute("style") ?? "").includes("background-image"),
    );
    expect(anyBg).toBe(false);
    expect(diagnostics.some((d) => d.field === "frame.backgrounds.src")).toBe(true);
    // R9 — the rejection diagnostic never carries the URL.
    expect(JSON.stringify(diagnostics)).not.toContain("evil.example.org");

    // #D + #E still render — one rejected asset does not collapse the node.
    expect(container.querySelector('[style*="mix-blend-mode"]')).not.toBeNull();
    expect(container.querySelector("mask")?.getAttribute("mask-type")).toBe("alpha");
  });

  it("deny-by-default — with NO provider the image-fill is dropped, blendMode + mask still render", async () => {
    await render(TRIPLE(GOOD)); // no AllowedHostsProvider wrapper

    const anyBg = Array.from(container.querySelectorAll("div")).some((d) =>
      (d.getAttribute("style") ?? "").includes("background-image"),
    );
    expect(anyBg).toBe(false);
    expect(diagnostics.some((d) => d.field === "frame.backgrounds.src")).toBe(true);

    expect(container.querySelector('[style*="mix-blend-mode"]')).not.toBeNull();
    expect(container.querySelector("mask")).not.toBeNull();
  });
});
