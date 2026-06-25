// ADR 006 (WebRTC mirror-compositor pivot) #4 — `media` primitive LIVE mode.
//
// Covered here :
//   BUNDLE (non-regression) — a `media` node with `src` still renders a
//         `<video src>` (gated). The new mode is strictly additive.
//   RC-3 — a `media` node with `peerLabel` resolves the peer's MediaStream
//         through the host resolver and mounts a `<video>` with that stream in
//         `srcObject`, in real time.
//   RC-Geo — the LIVE `<video>` is rendered at the EXACT geometry of the LSML
//         node (the UniversalWrapper's box) and fills it (100%/100% +
//         scene-authored object-fit) — NEVER forced full-screen/viewport. A
//         node autored bottom-left 320×180 renders a 320×180 bottom-left box.
//   RC-ReadOnly — the render pipeline is strictly read-only on the node /
//         SceneData : a deep-frozen node renders without throwing and is
//         byte-for-byte unchanged after render (geometry flows scene→render,
//         never render→scene).
//   resolver injection — absent resolver / unconnected peer (resolver → null)
//         leaves a stream-less inert box, no throw, no diagnostic.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { Tree } from "../../src/render/tree.js";
import { addDiagnosticsHandler, type RenderDiagnostic } from "../../src/render/diagnostics.js";
import type { RenderNode } from "../../src/render/bundle.js";
import { createStore } from "../../src/state/store.js";
import { LumencastRuntimeProvider } from "../../src/overlay/runtime-context.js";
import { AllowedHostsProvider } from "../../src/render/allowed-hosts.js";
import type { ResolvePeerStream } from "../../src/render/primitives/media.js";

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
  removeHandler = addDiagnosticsHandler((d) => diagnostics.push(d));
});

afterEach(async () => {
  removeHandler?.();
  removeHandler = undefined;
  await act(async () => root.unmount());
  container.remove();
  warnSpy.mockRestore();
});

/** Render a node directly (no runtime provider) — exercises the default (no
 *  resolver) LIVE path and the BUNDLE mode. An optional host allowlist feeds
 *  the `gateSrc` host-gate for BUNDLE `src`. */
async function render(node: RenderNode, hosts?: string[]): Promise<void> {
  const store = createStore();
  await act(async () => {
    root.render(
      <AllowedHostsProvider hosts={hosts}>
        <Tree node={node} store={store} />
      </AllowedHostsProvider>,
    );
  });
}

/** Render inside a runtime provider carrying the peer-stream resolver — the
 *  channel `mount()` uses to inject the viewer's `resolvePeerStream` (#3). */
async function renderWithRuntime(
  node: RenderNode,
  resolvePeerStream?: ResolvePeerStream,
): Promise<void> {
  const store = createStore();
  await act(async () => {
    root.render(
      <LumencastRuntimeProvider
        value={{
          mode: "broadcast",
          store,
          bundle: { root: node } as never,
          status: "live",
          sendInput: () => {},
          ...(resolvePeerStream !== undefined ? { resolvePeerStream } : {}),
        }}
      >
        <Tree node={node} store={store} />
      </LumencastRuntimeProvider>,
    );
  });
}

/** A real `MediaStream` (so `<video>.srcObject` accepts it under happy-dom). */
function fakeStream(): MediaStream {
  const stream = new MediaStream();
  (stream as unknown as { getTracks: () => MediaStreamTrack[] }).getTracks = () => [];
  return stream;
}

/** Deep-freeze a node so ANY write to it (a dimension, a prop) throws in strict
 *  mode — the strongest possible RC-ReadOnly assertion. */
function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

describe("media — BUNDLE mode (non-regression)", () => {
  it("renders a <video src> when the node carries `src` (no peerLabel)", async () => {
    await render(
      {
        kind: "media",
        id: "clip",
        props: { src: "https://assets.cyell.dev/intro.mp4", fit: "contain" },
      },
      ["assets.cyell.dev"],
    );
    const video = container.querySelector("video") as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    expect(video!.getAttribute("src")).toBe("https://assets.cyell.dev/intro.mp4");
    expect(video!.srcObject).toBeNull();
    expect(video!.style.objectFit).toBe("contain");
  });
});

describe("media — LIVE mode : RC-3 srcObject from a resolved peer stream", () => {
  it("resolves peerLabel → MediaStream and mounts it in srcObject", async () => {
    const stream = fakeStream();
    const resolvePeerStream = vi.fn().mockReturnValue(stream);
    await renderWithRuntime(
      {
        kind: "media",
        id: "cam",
        props: { peerLabel: "host-cam", fit: "cover" },
      },
      resolvePeerStream,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(resolvePeerStream).toHaveBeenCalledWith("host-cam");
    const video = container.querySelector("video") as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    expect(video!.srcObject).toBe(stream);
    // A live node has no `src` URL — the stream is the sole source.
    expect(video!.getAttribute("src")).toBeNull();
    // No diagnostic for entering LIVE mode.
    expect(diagnostics).toHaveLength(0);
  });

  it("leaves a stream-less inert box with no resolver, no throw, no diagnostic", async () => {
    await render({
      kind: "media",
      id: "cam",
      props: { peerLabel: "host-cam" },
    });
    expect(container.querySelector("video")).toBeNull();
    const box = container.querySelector("[data-lumencast-media-live]") as HTMLElement | null;
    expect(box).not.toBeNull();
    expect(box!.style.opacity).toBe("0");
    expect(diagnostics).toHaveLength(0);
  });

  it("a resolver returning null (peer not connected) is a stream-less box", async () => {
    const resolvePeerStream = vi.fn().mockReturnValue(null);
    await renderWithRuntime(
      { kind: "media", id: "cam", props: { peerLabel: "guest-1" } },
      resolvePeerStream,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(resolvePeerStream).toHaveBeenCalledWith("guest-1");
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("[data-lumencast-media-live]")).not.toBeNull();
    expect(diagnostics).toHaveLength(0);
  });
});

describe("media — LIVE mode : RC-Geo (exact node geometry, never full-screen)", () => {
  it("a bottom-left 320×180 node renders a 320×180 box, video filling it 100%/100%", async () => {
    const stream = fakeStream();
    const resolvePeerStream = vi.fn().mockReturnValue(stream);
    // Autored bottom-left on a 1920×1080 stage : x=0, y=900, 320×180. Props are
    // the compiler-flattened geometry (`x/y/width/height`) the Tree reads.
    await renderWithRuntime(
      {
        kind: "media",
        id: "cam",
        props: {
          peerLabel: "host-cam",
          fit: "cover",
          x: 0,
          y: 900,
          width: 320,
          height: 180,
        },
      },
      resolvePeerStream,
    );
    await act(async () => {
      await Promise.resolve();
    });

    const video = container.querySelector("video") as HTMLVideoElement | null;
    expect(video).not.toBeNull();

    // The UniversalWrapper carries the EXACT scene geometry (the box).
    const wrapper = video!.closest("[style*='width']") as HTMLElement | null;
    // The box sized by the wrapper is 320×180 at (0, 900) — NOT 1920×1080,
    // NOT the viewport. (The video itself fills that box at 100%/100%.)
    const boxEl = findGeometryBox(container);
    expect(boxEl).not.toBeNull();
    expect(boxEl!.style.width).toBe("320px");
    expect(boxEl!.style.height).toBe("180px");
    expect(boxEl!.style.left).toBe("0px");
    expect(boxEl!.style.top).toBe("900px");

    // The video element NEVER carries an absolute size — it only fills its box.
    expect(video!.style.width).toBe("100%");
    expect(video!.style.height).toBe("100%");
    expect(video!.style.objectFit).toBe("cover");
    // It is provably NOT forced full-screen : no 1920/1080/100vw/100vh anywhere
    // on the video.
    expect(video!.style.width).not.toBe("1920px");
    expect(video!.style.width).not.toBe("100vw");
    expect(video!.style.height).not.toBe("100vh");
    expect(wrapper).not.toBeNull();
  });
});

describe("media — LIVE mode : RC-ReadOnly (the render never writes the scene)", () => {
  it("renders a deep-frozen node without throwing and leaves it byte-for-byte unchanged", async () => {
    const stream = fakeStream();
    const resolvePeerStream = vi.fn().mockReturnValue(stream);
    const node: RenderNode = {
      kind: "media",
      id: "cam",
      props: {
        peerLabel: "host-cam",
        fit: "cover",
        x: 0,
        y: 900,
        width: 320,
        height: 180,
      },
    };
    const snapshot = structuredClone(node);
    deepFreeze(node); // any write to geometry/props would throw here.

    await renderWithRuntime(node, resolvePeerStream);
    await act(async () => {
      await Promise.resolve();
    });

    // Did not throw (frozen) AND is identical to the pre-render snapshot :
    // geometry flowed scene→render only, never render→scene.
    expect(node).toEqual(snapshot);
    expect(container.querySelector("video")).not.toBeNull();
  });
});

/** Find the absolutely-positioned geometry box the UniversalWrapper produced
 *  for the node (the element carrying the px width/height/left/top). */
function findGeometryBox(scope: HTMLElement): HTMLElement | null {
  const els = scope.querySelectorAll<HTMLElement>("div");
  for (const el of els) {
    if (
      el.style.width.endsWith("px") &&
      el.style.height.endsWith("px") &&
      el.style.position === "absolute"
    ) {
      return el;
    }
  }
  return null;
}
