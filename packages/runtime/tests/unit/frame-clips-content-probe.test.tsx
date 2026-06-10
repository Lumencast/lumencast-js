// Probe delta — frame `clipsContent` (ADR 001 §3.2.5 RC#5, issue #32).
//
// Complements Forge's frame-clips-content.test.tsx without duplicating it.
// Covers :
//   1. Hostile values not in Forge's it.each : `new Boolean(false)`, `-0`,
//      `Symbol()` — all must fallback clipped + R9 diagnostic.
//   2. Delta sequence false → true → hostile → false (inverse of Forge's
//      true → false → hostile → false).
//   3. Nested frames : parent default-clipped, child explicit `false` —
//      clip independence (child is NOT clipped even when parent is).
//   4. resolveClipsContent unit : `new Boolean(false)`, `-0`, Symbol-like.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { Tree } from "../../src/render/tree.js";
import { resolveClipsContent } from "../../src/render/primitives/frame.js";
import { createStore, type Store } from "../../src/state/store.js";
import type { RenderNode } from "../../src/render/bundle.js";
import { vi } from "vitest";

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

async function renderFrame(
  props: Record<string, unknown>,
  extra: Partial<RenderNode> = {},
): Promise<HTMLDivElement> {
  await act(async () => {
    root.render(
      <Tree
        node={{ kind: "frame", props: { width: 100, height: 100, ...props }, ...extra }}
        store={createStore()}
      />,
    );
  });
  const div = [...container.querySelectorAll("div")].find((d) =>
    (d.getAttribute("style") ?? "").includes("will-change"),
  );
  expect(div).toBeDefined();
  return div as HTMLDivElement;
}

function frameDiv(): HTMLDivElement {
  const div = [...container.querySelectorAll("div")].find((d) =>
    (d.getAttribute("style") ?? "").includes("will-change"),
  );
  expect(div).toBeDefined();
  return div as HTMLDivElement;
}

function styleOf(el: Element): string {
  return el.getAttribute("style") ?? "";
}

// ─── 1. resolveClipsContent unit — hostile values not in Forge ───────────

describe("resolveClipsContent unit — hostiles not in Forge it.each", () => {
  it("new Boolean(false) is an object, not a boolean → fallback true (clipped)", () => {
    // A JSON-transmitted `false` is a JS boolean, but a badly-typed
    // middleware may box it into new Boolean(false). The object is truthy
    // yet not `typeof boolean` — it must be rejected like any other junk.
    // eslint-disable-next-line no-new-wrappers
    expect(resolveClipsContent(new Boolean(false))).toBe(true);
  });

  it("-0 is typeof number, not boolean → fallback true (clipped)", () => {
    // -0 is `typeof 'number'`, Number.isFinite(-0) === true, but it is
    // not a boolean. resolveClipsContent must NOT coerce it to `false`.
    expect(resolveClipsContent(-0)).toBe(true);
  });

  it("Symbol() is not a boolean → fallback true (clipped)", () => {
    // Symbols cannot be serialised to JSON, but can appear on a live
    // store path through a misconfigured adapter.
    expect(resolveClipsContent(Symbol("clips"))).toBe(true);
  });
});

// ─── 2. Hostile DOM render not in Forge it.each ─────────────────────────

describe("clipsContent hostile DOM render — values not in Forge it.each", () => {
  it("new Boolean(false) → R9 diagnostic + fallback clipped in DOM", async () => {
    // eslint-disable-next-line no-new-wrappers
    const div = await renderFrame({ clipsContent: new Boolean(false) });
    expect(div.style.overflow).toBe("hidden");
    const calls = warnSpy.mock.calls.flat().map(String);
    expect(calls.join(" ")).toContain("frame.clipsContent");
  });

  it("-0 → R9 diagnostic + fallback clipped in DOM", async () => {
    const div = await renderFrame({ clipsContent: -0 });
    expect(div.style.overflow).toBe("hidden");
    const calls = warnSpy.mock.calls.flat().map(String);
    expect(calls.join(" ")).toContain("frame.clipsContent");
  });
});

// ─── 3. Delta sequence false → true → hostile → false ───────────────────

describe("clipsContent live delta — false→true→hostile→false sequence", () => {
  it("starts unclipped, clips on true, fallback on hostile, recovers to unclipped", async () => {
    const store = createStore();
    store.set("f.clips", false);
    const node: RenderNode = {
      kind: "frame",
      props: { width: 100, height: 100 },
      bindings: { clipsContent: "f.clips" },
    };
    await act(async () => {
      root.render(<Tree node={node} store={store} />);
    });
    const div = frameDiv();

    // Step 1 : false → no overflow declaration
    expect(div.style.overflow).toBe("");
    expect(styleOf(div)).not.toContain("overflow");

    // Step 2 : true → overflow: hidden
    await act(async () => store.set("f.clips", true));
    expect(div.style.overflow).toBe("hidden");
    expect(warnSpy).not.toHaveBeenCalled();

    // Step 3 : hostile string → R9 diagnostic + fail-closed (clipped)
    await act(async () => store.set("f.clips", "false"));
    expect(div.style.overflow).toBe("hidden");
    expect(warnSpy.mock.calls.flat().map(String).join(" ")).toContain("frame.clipsContent");

    // Step 4 : valid false again → unclipped (recovery)
    warnSpy.mockClear();
    await act(async () => store.set("f.clips", false));
    expect(div.style.overflow).toBe("");
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ─── 4. Nested frames — clip independence ────────────────────────────────

describe("clipsContent nested frames", () => {
  it("parent default-clipped, child explicit false — child is NOT clipped", async () => {
    // The parent frame has no clipsContent (spec default true → overflow:
    // hidden). The child explicitly sets clipsContent: false. The clip
    // must not propagate : each frame controls its own overflow
    // independently (CSS overflow is per-element, not inherited).
    const node: RenderNode = {
      kind: "frame",
      props: { width: 200, height: 200 },
      children: [
        {
          kind: "frame",
          props: { width: 100, height: 100, clipsContent: false },
        },
      ],
    };
    await act(async () => {
      root.render(<Tree node={node} store={createStore()} />);
    });
    const divs = [...container.querySelectorAll("div")].filter((d) =>
      (d.getAttribute("style") ?? "").includes("will-change"),
    );
    expect(divs).toHaveLength(2);
    const [parent, child] = divs as [HTMLDivElement, HTMLDivElement];
    // Parent clips (spec default).
    expect(parent.style.overflow).toBe("hidden");
    // Child is NOT clipped — its own clipsContent:false overrides nothing
    // from the parent ; CSS overflow is not inherited.
    expect(child.style.overflow).toBe("");
    expect(styleOf(child)).not.toContain("overflow");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("parent explicit false, child default (absent) → child clips independently", async () => {
    // Parent is unclipped. Child has no clipsContent → spec default true.
    // Proves the default is applied per-node, not inherited from parent.
    const node: RenderNode = {
      kind: "frame",
      props: { width: 200, height: 200, clipsContent: false },
      children: [
        {
          kind: "frame",
          props: { width: 100, height: 100 },
        },
      ],
    };
    await act(async () => {
      root.render(<Tree node={node} store={createStore()} />);
    });
    const divs = [...container.querySelectorAll("div")].filter((d) =>
      (d.getAttribute("style") ?? "").includes("will-change"),
    );
    expect(divs).toHaveLength(2);
    const [parent, child] = divs as [HTMLDivElement, HTMLDivElement];
    expect(parent.style.overflow).toBe(""); // parent: false, no overflow
    expect(child.style.overflow).toBe("hidden"); // child: absent → default true
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ─── 5. CSS interaction note : borderRadius ──────────────────────────────
//
// LSML 1.1 §4.3 does not declare `borderRadius` on `frame` ; the frame
// primitive does not emit it. Therefore no CSS `border-radius` / `clip-path`
// interaction with `overflow: hidden` is possible through this render path.
// If a future ADR adds `borderRadius` to `frame`, the clip-radius interaction
// (CSS overflow clips to the border-box including radius) will need a
// dedicated test. Documented here for the next engineer, not tested today.
