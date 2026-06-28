// ADR Blue 009 §3.1–3.3 (axe 1, antenne) — the `x-zab.meet-peer` SLOT renderer.
//
// Covered here :
//   dispatch — a node of kind "x-zab.meet-peer" is routed to the slot renderer
//         (the kind→primitive gap is closed ; NO unknown-kind drop → null).
//   slotRef key — the host peer-stream resolver is keyed by `x-zab.slotRef`
//         (NOT a peer_label) ; Solar's slot-aware registry translates it.
//   bound — a slot whose key resolves to a MediaStream paints it in
//         `<video srcObject>`.
//   unbound — a slot whose key resolves to `null` (no `__cam.slots.*` binding,
//         or the bound peer not connected) → a transparent inert box, no
//         diagnostic.
//   missing slotRef — a node without `x-zab.slotRef` → a transparent inert box,
//         no throw, no diagnostic (still a recognised kind).
//   RC-Geo — the <video> fills the EXACT node box (wrapper geometry), 100%/100%,
//         never full-screen.

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

describe("x-zab.meet-peer — dispatch + slotRef key", () => {
  it("routes kind:x-zab.meet-peer to the slot renderer (no unknown-kind drop)", async () => {
    const stream = realStream();
    const resolvePeerStream = vi.fn().mockReturnValue(stream);
    await renderWithViewer(
      { kind: "x-zab.meet-peer", id: "slot", props: { "x-zab.slotRef": "cam-caster-1" } },
      resolvePeerStream,
    );
    await act(async () => {
      await Promise.resolve();
    });
    // The resolver is keyed by the SLOT REF, not a peer_label.
    expect(resolvePeerStream).toHaveBeenCalledWith("cam-caster-1");
    const video = container.querySelector("video") as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    expect(video!.srcObject).toBe(stream);
    // Recognised kind — must NOT fall into the unknown-kind diagnostic.
    expect(diagnostics.map((d) => d.field)).not.toContain("kind");
  });
});

describe("x-zab.meet-peer — unbound slot → transparent placeholder", () => {
  it("a slot whose key resolves to null is a transparent inert box, no diagnostic", async () => {
    const resolvePeerStream = vi.fn().mockReturnValue(null);
    await renderWithViewer(
      { kind: "x-zab.meet-peer", id: "slot", props: { "x-zab.slotRef": "cam-caster-1" } },
      resolvePeerStream,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(resolvePeerStream).toHaveBeenCalledWith("cam-caster-1");
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("[data-lumencast-media-live]")).not.toBeNull();
    expect(diagnostics).toHaveLength(0);
  });

  it("a missing x-zab.slotRef is a transparent inert box, no throw, no diagnostic", async () => {
    await render({ kind: "x-zab.meet-peer", id: "slot", props: {} });
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("[data-lumencast-meet-peer-slot]")).not.toBeNull();
    expect(diagnostics).toHaveLength(0);
  });
});

describe("x-zab.meet-peer — RC-Geo (exact node box, never full-screen)", () => {
  it("a bottom-left 320×180 slot renders a 320×180 box, video filling it 100%/100%", async () => {
    const stream = realStream();
    const resolvePeerStream = vi.fn().mockReturnValue(stream);
    await renderWithViewer(
      {
        kind: "x-zab.meet-peer",
        id: "slot",
        // The compiled shape : flattened geometry + slotRef (no peer identity).
        props: { "x-zab.slotRef": "cam-caster-1", x: 0, y: 900, width: 320, height: 180 },
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

    expect(video!.style.width).toBe("100%");
    expect(video!.style.height).toBe("100%");
    expect(video!.style.width).not.toBe("1920px");
    expect(video!.style.height).not.toBe("100vh");
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
