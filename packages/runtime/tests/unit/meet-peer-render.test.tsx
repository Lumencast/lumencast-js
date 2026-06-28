// ADR 006 (WebRTC mirror-compositor pivot) §3.3/§3.5 — the unified `meet.peer`
// source renderer.
//
// Covered here :
//   dispatch — a node of kind "meet.peer" is routed to the srcObject renderer
//         (the kind→primitive mapping gap is closed ; no unknown-kind drop).
//   RC-3 — reads `peer_label`, resolves the peer's MediaStream via the host
//         viewer channel, and mounts it in `<video srcObject>`.
//   RC-Geo — the <video> fills the EXACT node box (wrapper geometry +
//         object_fit), never full-screen ; a bottom-left 320×180 node renders a
//         320×180 bottom-left box.
//   RC-ReadOnly — a deep-frozen node renders without throwing and is unchanged
//         after render (geometry flows scene→render only).
//   unconnected — empty/missing peer_label OR a not-yet-connected peer → a
//         transparent inert box, no throw, no diagnostic.
//   z-order — two ordered meet.peer siblings paint in document order (cam over
//         game = sibling order, no special z handling).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { Tree } from "../../src/render/tree.js";
import { addDiagnosticsHandler, type RenderDiagnostic } from "../../src/render/diagnostics.js";
import type { RenderNode } from "../../src/render/bundle.js";
import { createStore } from "../../src/state/store.js";
import { LumencastRuntimeProvider } from "../../src/overlay/runtime-context.js";
import type { ResolvePeerStream } from "../../src/render/primitives/media.js";

let container: HTMLDivElement;
let root: Root;
let diagnostics: RenderDiagnostic[];
let removeHandler: (() => void) | undefined;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  diagnostics = [];
  removeHandler = addDiagnosticsHandler((d) => diagnostics.push(d));
});

afterEach(async () => {
  removeHandler?.();
  removeHandler = undefined;
  await act(async () => root.unmount());
  container.remove();
});

function realStream(): MediaStream {
  const s = new MediaStream();
  (s as unknown as { getTracks: () => MediaStreamTrack[] }).getTracks = () => [];
  return s;
}

async function render(node: RenderNode): Promise<void> {
  const store = createStore();
  await act(async () => {
    root.render(<Tree node={node} store={store} />);
  });
}

async function renderWithViewer(
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

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

describe("meet.peer — dispatch + RC-3 srcObject", () => {
  it("routes kind:meet.peer to the srcObject renderer (no unknown-kind drop)", async () => {
    const stream = realStream();
    const resolvePeerStream = vi.fn().mockReturnValue(stream);
    await renderWithViewer(
      {
        kind: "meet.peer",
        id: "cam",
        props: { peer_label: "host_cam", object_fit: "cover" },
      },
      resolvePeerStream,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(resolvePeerStream).toHaveBeenCalledWith("host_cam");
    const video = container.querySelector("video") as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    expect(video!.srcObject).toBe(stream);
    // Recognised kind — must NOT fall into the unknown-kind diagnostic.
    expect(diagnostics.map((d) => d.field)).not.toContain("kind");
  });
});

describe("meet.peer — RC-Geo (exact node box, never full-screen)", () => {
  it("a bottom-left 320×180 node renders a 320×180 box, video filling it 100%/100%", async () => {
    const stream = realStream();
    const resolvePeerStream = vi.fn().mockReturnValue(stream);
    await renderWithViewer(
      {
        kind: "meet.peer",
        id: "cam",
        props: {
          peer_label: "host_cam",
          object_fit: "contain",
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

    const box = findGeometryBox(container);
    expect(box).not.toBeNull();
    expect(box!.style.width).toBe("320px");
    expect(box!.style.height).toBe("180px");
    expect(box!.style.left).toBe("0px");
    expect(box!.style.top).toBe("900px");

    // The video fills the box (never an absolute / full-viewport size).
    expect(video!.style.width).toBe("100%");
    expect(video!.style.height).toBe("100%");
    expect(video!.style.objectFit).toBe("contain"); // scene-authored object_fit
    expect(video!.style.width).not.toBe("1920px");
    expect(video!.style.width).not.toBe("100vw");
    expect(video!.style.height).not.toBe("100vh");
  });

  it("REAL from-scene shape — NESTED position/size flatten to the wrapper box (not 100% scene)", async () => {
    // This is the EXACT shape the Prism from-scene export emits (it bypasses
    // @lumencast/compiler, so geometry stays nested) and the shape that, before
    // the fix, rendered the node in NORMAL FLOW at scene size (observed DOM bug).
    // We dispatch through the REAL Tree — we do NOT hand the box to MeetPeer.
    const stream = realStream();
    const resolvePeerStream = vi.fn().mockReturnValue(stream);
    await renderWithViewer(
      {
        kind: "meet.peer",
        id: "cam",
        props: {
          peer_label: "host_cam",
          object_fit: "cover",
          position: { x: 0, y: 900 },
          size: { w: 320, h: 180 },
        },
      },
      resolvePeerStream,
    );
    await act(async () => {
      await Promise.resolve();
    });

    const box = findGeometryBox(container);
    expect(box).not.toBeNull();
    // The wrapper carries the NODE box (320×180 @ 0,900), absolutely placed —
    // NOT the scene (1920×1080), NOT normal flow.
    expect(box!.style.position).toBe("absolute");
    expect(box!.style.width).toBe("320px");
    expect(box!.style.height).toBe("180px");
    expect(box!.style.left).toBe("0px");
    expect(box!.style.top).toBe("900px");

    const video = container.querySelector("video") as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    expect(video!.style.width).toBe("100%"); // 100% of the 320×180 box, not the scene
    expect(video!.srcObject).toBe(stream);
  });
});

describe("meet.peer — RC-ReadOnly", () => {
  it("renders a deep-frozen node without throwing and leaves it unchanged", async () => {
    const stream = realStream();
    const resolvePeerStream = vi.fn().mockReturnValue(stream);
    const node: RenderNode = {
      kind: "meet.peer",
      id: "cam",
      props: { peer_label: "host_cam", object_fit: "cover", x: 0, y: 900, width: 320, height: 180 },
    };
    const snapshot = structuredClone(node);
    deepFreeze(node);

    await renderWithViewer(node, resolvePeerStream);
    await act(async () => {
      await Promise.resolve();
    });

    expect(node).toEqual(snapshot);
    expect(container.querySelector("video")).not.toBeNull();
  });
});

describe("meet.peer — unconnected / missing label", () => {
  it("a not-yet-connected peer (resolver → null) is a transparent inert box, no diagnostic", async () => {
    const resolvePeerStream = vi.fn().mockReturnValue(null);
    await renderWithViewer(
      { kind: "meet.peer", id: "cam", props: { peer_label: "host_cam" } },
      resolvePeerStream,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("[data-lumencast-media-live]")).not.toBeNull();
    expect(diagnostics).toHaveLength(0);
  });

  it("a missing peer_label is a transparent inert box, no throw, no diagnostic", async () => {
    await render({ kind: "meet.peer", id: "cam", props: { object_fit: "cover" } });
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("[data-lumencast-meet-peer]")).not.toBeNull();
    expect(diagnostics).toHaveLength(0);
  });
});

describe("meet.peer — z-order = sibling order", () => {
  it("two ordered meet.peer siblings paint in document order (cam over game)", async () => {
    const game = realStream();
    const cam = realStream();
    const resolvePeerStream = vi.fn((label: string) => (label === "game_main" ? game : cam));
    await renderWithViewer(
      {
        kind: "stack",
        id: "scene",
        props: {},
        children: [
          {
            kind: "meet.peer",
            id: "game",
            props: { peer_label: "game_main", width: 1920, height: 1080 },
          },
          {
            kind: "meet.peer",
            id: "cam",
            props: { peer_label: "host_cam", x: 0, y: 900, width: 320, height: 180 },
          },
        ],
      },
      resolvePeerStream,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const videos = container.querySelectorAll("video");
    expect(videos).toHaveLength(2);
    // Document order = sibling order : game first (behind), cam second (over).
    expect(videos[0].srcObject).toBe(game);
    expect(videos[1].srcObject).toBe(cam);
  });
});

/** The absolutely-positioned geometry box the UniversalWrapper produced. */
function findGeometryBox(scope: HTMLElement): HTMLElement | null {
  for (const el of scope.querySelectorAll<HTMLElement>("div")) {
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
