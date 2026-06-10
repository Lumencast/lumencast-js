// LSML 1.1 §6 `animate.from` — mount-play proof at the component level.
//
// The fix: a node carrying a lowered `animate_initial` map makes its
// rendering primitive mount with framer-motion `initial={from}` and
// animate to its target on mount (initial ≠ first-frame target). A node
// without `animate_initial` keeps the prior behaviour (initial pinned to
// the target — no mount-play). framer-motion's visual animation is a
// no-op under happy-dom (it writes the *target* to inline style on the
// first tick — see the runtime mount-play probe), so we prove the wiring
// deterministically by capturing the exact `initial` / `animate` props the
// runtime hands the motion element. That is the component-level contract:
// the runtime asks framer to start at `from` and converge to the target.

import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";

// `createElement` is needed inside the hoisted mock factory ; `vi.hoisted`
// lifts it above the `vi.mock` call so the factory can close over it.
const h = vi.hoisted(() => ({ createElement: null as unknown as typeof createElement }));
h.createElement = createElement;

// Replace framer's `motion.<tag>` proxy with plain DOM elements that
// serialise the animation props into data-* attributes we can read back.
vi.mock("framer-motion", () => {
  const motion = new Proxy(
    {},
    {
      get(_t, tag: string) {
        return function MotionStub(props: Record<string, unknown>) {
          const {
            initial,
            animate,
            transition,
            children,
            style: _style,
            ...rest
          } = props as {
            initial?: unknown;
            animate?: unknown;
            transition?: unknown;
            children?: ReactNode;
            style?: unknown;
          };
          return h.createElement(
            tag === "img" || tag === "svg" || tag === "span" || tag === "div" ? tag : "div",
            {
              ...(rest as Record<string, unknown>),
              "data-initial": JSON.stringify(initial ?? null),
              "data-animate": JSON.stringify(animate ?? null),
              "data-transition": JSON.stringify(transition ?? null),
            },
            children as ReactNode,
          );
        };
      },
    },
  );
  // Minimal motion-value stubs — tree.tsx's useBindAnimate (issue #33)
  // creates a fixed motion-value channel set unconditionally (hook-order
  // stability), so the mock must provide these even though no node in
  // this suite carries `animateBindings`.
  const stubMotionValue = () => ({
    get: () => 0,
    set: () => {},
    jump: () => {},
    on: () => () => {},
    getVelocity: () => 0,
    stop: () => {},
    destroy: () => {},
  });
  return {
    motion,
    useMotionValue: stubMotionValue,
    useTransform: stubMotionValue,
    animate: () => ({ stop: () => {} }),
  };
});

import { Tree } from "../../src/render/tree.js";
import { createStore } from "../../src/state/store.js";
import type { RenderNode } from "../../src/render/bundle.js";

async function renderNode(node: RenderNode, seed?: Record<string, unknown>): Promise<HTMLElement> {
  const store = createStore();
  if (seed) for (const [k, v] of Object.entries(seed)) store.set(k, v);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Tree node={node} store={store} />);
  });
  return container;
}

function readMotion(el: Element): {
  initial: Record<string, unknown> | null;
  animate: Record<string, unknown> | null;
  transition: Record<string, unknown> | null;
} {
  return {
    initial: JSON.parse(el.getAttribute("data-initial") ?? "null"),
    animate: JSON.parse(el.getAttribute("data-animate") ?? "null"),
    transition: JSON.parse(el.getAttribute("data-transition") ?? "null"),
  };
}

describe("LSML 1.1 §6 animate.from — mount-play", () => {
  it("image with animate_initial mounts at the from-state and animates to the target", async () => {
    const node: RenderNode = {
      kind: "image",
      props: { alt: "logo", width: 200, height: 200 },
      bindings: { src: "logo.src" },
      // compiler lowers animate.from {opacity:0, transform:{scale:0.85}} → this
      animate_initial: { opacity: 0, scale: 0.85 },
      transitions: { opacity: { kind: "tween", duration_ms: 550, ease: "cubic-out" } },
    };
    const container = await renderNode(node, { "logo.src": "logo.png" });
    const img = container.querySelector("img")!;
    const { initial, animate, transition } = readMotion(img);

    // PROOF of mount-play: first frame ≠ final frame.
    expect(initial).toEqual({ opacity: 0, scale: 0.85 });
    // target converges opacity→1 (declared) and scale→1 (identity), so the
    // element visibly fades+scales in even though Image natively drives only
    // opacity.
    expect(animate).toEqual({ opacity: 1, scale: 1 });
    expect(initial).not.toEqual(animate);
    // timing is carried from the lowered transition (550ms tween).
    expect(transition).toMatchObject({ type: "tween", duration: 0.55 });
  });

  it("frame with animate_initial mounts at from and converges all transform axes", async () => {
    const node: RenderNode = {
      kind: "frame",
      props: { width: 1920, height: 1080, background: "#fff" },
      animate_initial: { opacity: 0, scale: 0.85 },
      transitions: { opacity: { kind: "tween", duration_ms: 550, ease: "cubic-out" } },
    };
    const container = await renderNode(node);
    const div = container.querySelector("div > div") ?? container.querySelector("div");
    const { initial, animate } = readMotion(div!);
    expect(initial).toEqual({ opacity: 0, scale: 0.85 });
    // Frame natively animates opacity/x/y/scale/rotate — all present in target.
    expect(animate).toMatchObject({ opacity: 1, scale: 1, x: 0, y: 0, rotate: 0 });
    expect(initial).not.toEqual(animate);
  });

  it("REGRESSION: a node WITHOUT animate_initial does not mount-play (initial === target)", async () => {
    const node: RenderNode = {
      kind: "image",
      props: { alt: "logo", width: 200, height: 200, opacity: 1 },
      bindings: { src: "logo.src" },
      // legacy animate → transitions only, no from
      transitions: { opacity: { kind: "tween", duration_ms: 200, ease: "cubic-out" } },
    };
    const container = await renderNode(node, { "logo.src": "logo.png" });
    const img = container.querySelector("img")!;
    const { initial, animate } = readMotion(img);
    // No mount-play: framer mounts directly at the target (no visible jump,
    // no fade-in) — identical to the pre-fix behaviour.
    expect(initial).toEqual(animate);
    expect(initial).toEqual({ opacity: 1 });
  });

  it("BUG #snap: animate_initial WITHOUT per-prop transitions gets the default mount timing, not duration 0", async () => {
    // v0.3.0 regression : `toFramer(undefined)` → `{duration: 0}` made the
    // mount-play complete in a single frame (visual snap) whenever no
    // `transitions[key]` entry resolved for the animated keys — which is
    // exactly what the real wire served (no per-prop entries).
    const node: RenderNode = {
      kind: "image",
      props: { alt: "logo", width: 200, height: 200 },
      bindings: { src: "logo.src" },
      animate_initial: { opacity: 0, scale: 0.85 },
      // no `transitions` at all
    };
    const container = await renderNode(node, { "logo.src": "logo.png" });
    const img = container.querySelector("img")!;
    const { initial, animate, transition } = readMotion(img);
    expect(initial).toEqual({ opacity: 0, scale: 0.85 });
    expect(animate).toEqual({ opacity: 1, scale: 1 });
    // The mount-play must tween — never a zero-duration snap.
    expect(transition).toMatchObject({ type: "tween", duration: 0.4 });
  });

  it("BUG #snap: a transitions entry on a mount-play key (scale) is honoured even when the primitive does not natively look it up", async () => {
    const node: RenderNode = {
      kind: "image",
      props: { alt: "logo", width: 200, height: 200 },
      bindings: { src: "logo.src" },
      animate_initial: { scale: 0.85 },
      // compiler lowered animate.transform.scale → a `scale` transition ;
      // Image natively looks up only opacity/src.
      transitions: { scale: { kind: "tween", duration_ms: 1200, ease: "cubic-out" } },
    };
    const container = await renderNode(node, { "logo.src": "logo.png" });
    const img = container.querySelector("img")!;
    const { transition } = readMotion(img);
    expect(transition).toMatchObject({ type: "tween", duration: 1.2 });
  });

  it("REGRESSION: no animate_initial and no transitions still means no animation (deltas snap)", async () => {
    const node: RenderNode = {
      kind: "image",
      props: { alt: "logo", width: 200, height: 200 },
      bindings: { src: "logo.src" },
    };
    const container = await renderNode(node, { "logo.src": "logo.png" });
    const img = container.querySelector("img")!;
    const { transition } = readMotion(img);
    expect(transition).toMatchObject({ duration: 0 });
  });

  it("REGRESSION: a from with only opacity leaves transform untouched on an opacity primitive", async () => {
    const node: RenderNode = {
      kind: "text",
      props: { opacity: 1 },
      bindings: { value: "title.value" },
      animate_initial: { opacity: 0 },
    };
    const container = await renderNode(node, { "title.value": "Zab" });
    const span = container.querySelector("span")!;
    const { initial, animate } = readMotion(span);
    expect(initial).toEqual({ opacity: 0 });
    expect(animate).toEqual({ opacity: 1 });
  });
});
