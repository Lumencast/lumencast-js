// Frame `clipsContent` rendering — ADR 001 §3.2.5 + §6 RC#5 (issue #32).
//
// Three layers of proof :
//   1. DOM smoke of both states (RC#5) : absent or `true` → `overflow:
//      hidden` ; `false` → no overflow declaration (CSS initial =
//      visible), asserted on a real DOM node with an actually
//      overflowing child ;
//   2. grammar gate — the prop is wire-drivable (static prop AND live
//      LSDP delta through `resolveProps`, tree.tsx) : a non-boolean is
//      rejected with an R9 diagnostic (value withheld) and falls back
//      to the spec default (`true`, clipped) — and a later valid delta
//      recovers ;
//   3. no regression on the pre-existing frame fields (size, position,
//      background, opacity, mount-play).
//
// Anti-drop note (ADR 001 §3.4) : `clipsContent` lowers only on `frame`
// nodes (compile.ts) and `frame.tsx` is the single render path for that
// kind — the prop is consumed here, and the only rejection path (non-
// boolean) emits the diagnostic asserted below. No silent-drop path
// remains.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { Tree } from "../../src/render/tree.js";
import { resolveClipsContent } from "../../src/render/primitives/frame.js";
import { createStore, type Store } from "../../src/state/store.js";
import type { RenderNode } from "../../src/render/bundle.js";

let container: HTMLDivElement;
let root: Root;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  warnSpy.mockRestore();
});

async function render(node: RenderNode, store: Store): Promise<void> {
  await act(async () => {
    root.render(<Tree node={node} store={store} />);
  });
}

/** Render a single frame and return its motion.div (identified by the
 *  frame-specific `will-change: transform, opacity` declaration). */
async function renderFrame(
  props: Record<string, unknown>,
  extra: Partial<RenderNode> = {},
): Promise<HTMLDivElement> {
  await render(
    { kind: "frame", props: { width: 100, height: 100, ...props }, ...extra },
    createStore(),
  );
  return frameDiv();
}

function frameDiv(): HTMLDivElement {
  const div = [...container.querySelectorAll("div")].find((d) =>
    (d.getAttribute("style") ?? "").includes("will-change"),
  );
  expect(div).toBeDefined();
  return div as HTMLDivElement;
}

function styleOf(el: Element | null): string {
  return el?.getAttribute("style") ?? "";
}

// ─── 1. DOM smoke of both states (RC#5) ──────────────────────────────

describe("frame clipsContent — DOM smoke (ADR 001 RC#5)", () => {
  it("absent → spec default `true` → overflow: hidden", async () => {
    const div = await renderFrame({});
    expect(div.style.overflow).toBe("hidden");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("explicit true → overflow: hidden", async () => {
    const div = await renderFrame({ clipsContent: true });
    expect(div.style.overflow).toBe("hidden");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("false → no overflow declaration (CSS initial = visible)", async () => {
    const div = await renderFrame({ clipsContent: false });
    expect(div.style.overflow).toBe("");
    expect(styleOf(div)).not.toContain("overflow");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("an actually overflowing child sits inside the clipping box", async () => {
    // Child frame positioned entirely past the parent's 100×100 bounds.
    // happy-dom does no layout, so "really clipped" is proven by the
    // clipping contract the browser executes : the child IS in the DOM,
    // positioned outside the bounds, and its nearest positioned ancestor
    // carries `overflow: hidden`.
    const node: RenderNode = {
      kind: "frame",
      props: { width: 100, height: 100 },
      children: [{ kind: "frame", props: { width: 50, height: 50, x: 200, y: 200 } }],
    };
    await render(node, createStore());
    const divs = [...container.querySelectorAll("div")].filter((d) =>
      (d.getAttribute("style") ?? "").includes("will-change"),
    );
    expect(divs).toHaveLength(2);
    const [parent, child] = divs as [HTMLDivElement, HTMLDivElement];
    expect(parent.contains(child)).toBe(true);
    expect(parent.style.overflow).toBe("hidden");
    expect(parent.style.position).toBe("absolute");
    expect(child.style.position).toBe("absolute"); // out-of-bounds child clips against the parent box
  });
});

// ─── 2. grammar gate — static AND live delta, R9 diagnostic ──────────

const EVIL = "true; } body { background: url(http://evil) ; } x {";

describe("clipsContent grammar gate — non-boolean rejected, never injected", () => {
  it.each([[EVIL], ["true"], [1], [0], [null], [{}], [Number.NaN]])(
    "static non-boolean %j → R9 diagnostic + fallback to default (clipped)",
    async (value) => {
      const div = await renderFrame({ clipsContent: value });
      // Fallback = spec default (clipped) ; raw value never in the CSS.
      expect(div.style.overflow).toBe("hidden");
      expect(styleOf(div)).not.toContain("evil");
      expect(styleOf(div)).not.toContain("url(");
      // R9 : diagnostic names the field, never the value.
      const calls = warnSpy.mock.calls.flat().map(String);
      expect(calls.join(" ")).toContain("frame.clipsContent");
      for (const arg of calls) {
        expect(arg).not.toContain("evil");
        expect(arg).not.toContain(String(value));
      }
    },
  );

  it("boundary : resolveClipsContent maps undefined/true→true, false→false, junk→true", () => {
    expect(resolveClipsContent(undefined)).toBe(true);
    expect(resolveClipsContent(true)).toBe(true);
    expect(resolveClipsContent(false)).toBe(false);
    expect(resolveClipsContent("false")).toBe(true); // strings are hostile, never coerced
    expect(resolveClipsContent(EVIL)).toBe(true);
  });

  it("live delta : true → false → hostile → recovery", async () => {
    const store = createStore();
    store.set("f.clips", true);
    const node: RenderNode = {
      kind: "frame",
      props: { width: 100, height: 100 },
      bindings: { clipsContent: "f.clips" },
    };
    await render(node, store);
    const div = frameDiv();
    expect(div.style.overflow).toBe("hidden");

    await act(async () => store.set("f.clips", false));
    expect(div.style.overflow).toBe("");

    await act(async () => store.set("f.clips", EVIL));
    // Hostile delta → diagnostic + fallback to the spec default (clipped).
    expect(div.style.overflow).toBe("hidden");
    expect(styleOf(div)).not.toContain("evil");
    expect(styleOf(div)).not.toContain("url(");
    expect(warnSpy.mock.calls.flat().map(String).join(" ")).toContain("frame.clipsContent");

    await act(async () => store.set("f.clips", false));
    expect(div.style.overflow).toBe(""); // recovers after the hostile delta
  });
});

// ─── 3. no regression on pre-existing frame fields ───────────────────

describe("pre-existing frame fields — no regression", () => {
  it("size/position/background/opacity all still render alongside the clip", async () => {
    const div = await renderFrame({
      x: 10,
      y: 20,
      width: 640,
      height: 360,
      background: "#102030",
      opacity: 0.5,
    });
    expect(div.style.width).toBe("640px");
    expect(div.style.height).toBe("360px");
    expect(div.style.background).toContain("#102030");
    expect(div.style.overflow).toBe("hidden"); // default still applies
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("clipsContent: false does not disturb backgrounds[] rendering", async () => {
    const div = await renderFrame({
      clipsContent: false,
      backgrounds: [{ kind: "solid", color: "#ff0000" }],
    });
    expect(styleOf(div)).not.toContain("overflow");
    // backgroundsToCss stacks fills via background-image gradients.
    expect(styleOf(div)).toContain("#ff0000");
  });
});
