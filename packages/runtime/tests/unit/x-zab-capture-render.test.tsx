// RFC-0001 / ADR 004 §Amendment 1 — `x-zab.capture` vendor primitive, runtime arm.
//
// Covered here :
//   RC2 (revised) — on a NON-capable host (no `getUserMedia`, e.g. CEF/Pulsar
//         on-air or jsdom without a mock) the node renders a transparent box of
//         the declared geometry, 0 painted pixels, 0 acquisition, 0 diagnostic
//         (PLACEHOLDER mode).
//   RC6 — the runtime publishes `x-zab.capture/1` in SUPPORTED_PROFILES and a
//         bundle declaring that profile is NOT rejected.
//   RC8 — on a CAPABLE host (mocked `getUserMedia`) the node enters ACQUIRE,
//         calls `getUserMedia` once, mounts a `<video>` with the stream ; an
//         acquisition failure falls back to PLACEHOLDER without throwing.
//   RC9 — a supplied `resolveCaptureDevice` is called with the LOGICAL
//         `deviceRef` and its `deviceId` becomes a `getUserMedia` constraint ;
//         no resolver → default constraints (no deviceId), no throw, no
//         PLACEHOLDER.
//   RC11 — unmount stops every MediaStream track (no camera leak).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { Tree } from "../../src/render/tree.js";
import { addDiagnosticsHandler, type RenderDiagnostic } from "../../src/render/diagnostics.js";
import {
  SUPPORTED_PROFILES,
  validateBundleProfiles,
  type RenderNode,
} from "../../src/render/bundle.js";
import { createStore } from "../../src/state/store.js";
import { LumencastRuntimeProvider } from "../../src/overlay/runtime-context.js";
import type { ResolveCaptureDevice } from "../../src/render/primitives/capture.js";

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

async function render(node: RenderNode): Promise<void> {
  const store = createStore();
  await act(async () => {
    root.render(<Tree node={node} store={store} />);
  });
}

/** Render inside a runtime provider carrying an optional capture resolver — the
 *  channel `mount()` uses to inject the host's `resolveCaptureDevice`. */
async function renderWithRuntime(
  node: RenderNode,
  resolveCaptureDevice?: ResolveCaptureDevice,
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
          ...(resolveCaptureDevice !== undefined ? { resolveCaptureDevice } : {}),
        }}
      >
        <Tree node={node} store={store} />
      </LumencastRuntimeProvider>,
    );
  });
}

/** Install a capture-capable `navigator.mediaDevices` for the duration of `fn`,
 *  restoring the original afterwards. */
async function withMediaDevices(
  mediaDevices: Partial<MediaDevices>,
  fn: () => Promise<void>,
): Promise<void> {
  const original = (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
  Object.defineProperty(navigator, "mediaDevices", {
    value: mediaDevices,
    configurable: true,
  });
  try {
    await fn();
  } finally {
    Object.defineProperty(navigator, "mediaDevices", {
      value: original,
      configurable: true,
    });
  }
}

/** A real `MediaStream` (so `<video>.srcObject` accepts it under happy-dom)
 *  whose tracks expose a spy-able `stop` for the RC11 cleanup assertion. */
function fakeStream(): { stream: MediaStream; stop: ReturnType<typeof vi.fn> } {
  const stop = vi.fn();
  const track = { stop, kind: "video" } as unknown as MediaStreamTrack;
  const stream = new MediaStream();
  // happy-dom's fresh stream has no tracks ; expose ours for getTracks().
  (stream as unknown as { getTracks: () => MediaStreamTrack[] }).getTracks = () => [track];
  return { stream, stop };
}

describe("x-zab.capture — RC2 (revised) : transparent PLACEHOLDER on a non-capable host", () => {
  it("renders a box of the declared geometry, fully transparent", async () => {
    await render({
      kind: "x-zab.capture",
      id: "cam",
      props: {
        "x-zab.sourceKind": "media.webcam",
        "x-zab.deviceRef": "primary-cam",
        width: 640,
        height: 360,
      },
    });
    const box = container.querySelector("[data-lumencast-capture]") as HTMLElement | null;
    expect(box).not.toBeNull();
    expect(box!.style.width).toBe("640px");
    expect(box!.style.height).toBe("360px");
    // 0 painted pixels.
    expect(box!.style.opacity).toBe("0");
  });

  it("embeds no media element and is not the unknown-kind path", async () => {
    await render({
      kind: "x-zab.capture",
      id: "cam",
      props: {
        "x-zab.sourceKind": "media.screen",
        "x-zab.deviceRef": "main-display",
        width: 100,
        height: 100,
      },
    });
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("audio")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    // The recognised kind must NOT fall into the unknown-kind diagnostic.
    expect(diagnostics.map((d) => d.field)).not.toContain("kind");
  });

  it("never acquires when navigator.mediaDevices is absent (non-capable)", async () => {
    // jsdom has no mediaDevices by default → capability detection picks
    // PLACEHOLDER, which never reaches any device API.
    await withMediaDevices(undefined as never, async () => {
      // Force-absent (some jsdom versions stub a partial object).
      Object.defineProperty(navigator, "mediaDevices", {
        value: undefined,
        configurable: true,
      });
      await render({
        kind: "x-zab.capture",
        id: "cam",
        props: {
          "x-zab.sourceKind": "media.webcam",
          "x-zab.deviceRef": "primary-cam",
          width: 640,
          height: 360,
        },
      });
      const box = container.querySelector("[data-lumencast-capture]") as HTMLElement | null;
      expect(box).not.toBeNull();
      expect(box!.style.opacity).toBe("0");
      expect(container.querySelector("video")).toBeNull();
    });
  });

  it("emits NO diagnostic for the absence of a stream (absence is the contract)", async () => {
    await render({
      kind: "x-zab.capture",
      id: "cam",
      props: {
        "x-zab.sourceKind": "media.webcam",
        "x-zab.deviceRef": "primary-cam",
        width: 640,
        height: 360,
      },
    });
    expect(diagnostics).toHaveLength(0);
  });

  it("an audio-only capture renders a zero-area inert box (no size)", async () => {
    await render({
      kind: "x-zab.capture",
      id: "mic",
      props: { "x-zab.sourceKind": "media.mic", "x-zab.deviceRef": "main-mic" },
    });
    const box = container.querySelector("[data-lumencast-capture]") as HTMLElement | null;
    expect(box).not.toBeNull();
    expect(diagnostics).toHaveLength(0);
  });
});

describe("x-zab.capture — RC8 : ACQUIRE on a capable host", () => {
  it("calls getUserMedia once and mounts a <video> for a visual kind", async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    // A declared deviceRef MUST be backed by a resolver that returns a real deviceId;
    // otherwise the no-default-on-declared-ref rule (RC9) sends it to PLACEHOLDER.
    const resolveCaptureDevice = vi.fn().mockReturnValue({ deviceId: "phys-cam" });
    await withMediaDevices({ getUserMedia } as never, async () => {
      await renderWithRuntime(
        {
          kind: "x-zab.capture",
          id: "cam",
          props: {
            "x-zab.sourceKind": "media.webcam",
            "x-zab.deviceRef": "primary-cam",
            width: 640,
            height: 360,
          },
        },
        resolveCaptureDevice,
      );
      // Let the async acquisition + state update flush.
      await act(async () => {
        await Promise.resolve();
      });
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      const video = container.querySelector("video") as HTMLVideoElement | null;
      expect(video).not.toBeNull();
      expect(video!.srcObject).toBe(stream);
      // No diagnostic for entering ACQUIRE.
      expect(diagnostics).toHaveLength(0);
    });
  });

  it("uses getDisplayMedia for media.screen when no deviceRef is declared", async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi.fn();
    const getDisplayMedia = vi.fn().mockResolvedValue(stream);
    await withMediaDevices({ getUserMedia, getDisplayMedia } as never, async () => {
      // Empty deviceRef → declaredRef=false → falls through to getDisplayMedia({video:true}).
      // A non-empty deviceRef without a resolver that returns captureSourceId would be PLACEHOLDER.
      await renderWithRuntime({
        kind: "x-zab.capture",
        id: "scr",
        props: { "x-zab.sourceKind": "media.screen", "x-zab.deviceRef": "", width: 100, height: 100 },
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(getDisplayMedia).toHaveBeenCalledTimes(1);
      expect(getUserMedia).not.toHaveBeenCalled();
      expect(container.querySelector("video")).not.toBeNull();
    });
  });

  it("an audio kind acquires but stays visually empty (no <video>)", async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    await withMediaDevices({ getUserMedia } as never, async () => {
      // Empty deviceRef → declaredRef=false → getUserMedia({audio:true}) (host default).
      await renderWithRuntime({
        kind: "x-zab.capture",
        id: "mic",
        props: { "x-zab.sourceKind": "media.mic", "x-zab.deviceRef": "" },
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
      expect(container.querySelector("video")).toBeNull();
      const box = container.querySelector("[data-lumencast-capture]") as HTMLElement | null;
      expect(box).not.toBeNull();
    });
  });

  it("falls back to PLACEHOLDER without throwing when acquisition fails", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error("permission denied"));
    // Resolver must return a valid deviceId so getUserMedia IS reached before failing.
    const resolveCaptureDevice = vi.fn().mockReturnValue({ deviceId: "phys-cam" });
    await withMediaDevices({ getUserMedia } as never, async () => {
      await renderWithRuntime(
        {
          kind: "x-zab.capture",
          id: "cam",
          props: { "x-zab.sourceKind": "media.webcam", "x-zab.deviceRef": "primary-cam", width: 640, height: 360 },
        },
        resolveCaptureDevice,
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      // PLACEHOLDER box, no video, no diagnostic.
      const box = container.querySelector("[data-lumencast-capture]") as HTMLElement | null;
      expect(box).not.toBeNull();
      expect(box!.style.opacity).toBe("0");
      expect(container.querySelector("video")).toBeNull();
      expect(diagnostics).toHaveLength(0);
    });
  });
});

describe("x-zab.capture — RC9 : host device resolver", () => {
  it("calls the resolver with the logical deviceRef and pins the deviceId with exact constraint", async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    const resolveCaptureDevice = vi.fn().mockReturnValue({ deviceId: "phys-123" });
    await withMediaDevices({ getUserMedia } as never, async () => {
      await renderWithRuntime(
        {
          kind: "x-zab.capture",
          id: "cam",
          props: { "x-zab.sourceKind": "media.webcam", "x-zab.deviceRef": "primary-cam", width: 640, height: 360 },
        },
        resolveCaptureDevice,
      );
      await act(async () => {
        await Promise.resolve();
      });
      expect(resolveCaptureDevice).toHaveBeenCalledWith("primary-cam", "media.webcam");
      // Resolved deviceId is pinned with `exact`, NOT an ideal constraint — prevents
      // silent fallback to the wrong camera when the requested device is inactive.
      expect(getUserMedia).toHaveBeenCalledWith({ video: { deviceId: { exact: "phys-123" } } });
    });
  });

  it("with no resolver and no declared deviceRef, getUserMedia uses default constraints (no deviceId), no throw", async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    await withMediaDevices({ getUserMedia } as never, async () => {
      // Empty deviceRef → declaredRef=false → no-default-on-declared-ref rule does NOT
      // apply → getUserMedia({video:true}) (host default). This is the only path where
      // the bare default constraint survives under the new contract.
      await renderWithRuntime({
        kind: "x-zab.capture",
        id: "cam",
        props: { "x-zab.sourceKind": "media.webcam", "x-zab.deviceRef": "", width: 640, height: 360 },
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(getUserMedia).toHaveBeenCalledWith({ video: true });
      expect(container.querySelector("video")).not.toBeNull();
    });
  });

  it("a resolver returning null with a declared deviceRef yields PLACEHOLDER (no getUserMedia)", async () => {
    // §A1.3 (amended) — no-default-on-declared-ref: if deviceRef is declared but the
    // resolver cannot bind it to a real deviceId, acquireStream returns null → PLACEHOLDER.
    // getUserMedia MUST NOT be called — the old "fall back to default cam" silent
    // allocation is the exact bug this rule closes.
    const getUserMedia = vi.fn();
    const resolveCaptureDevice = vi.fn().mockReturnValue(null);
    await withMediaDevices({ getUserMedia } as never, async () => {
      await renderWithRuntime(
        {
          kind: "x-zab.capture",
          id: "cam",
          props: { "x-zab.sourceKind": "media.webcam", "x-zab.deviceRef": "primary-cam", width: 640, height: 360 },
        },
        resolveCaptureDevice,
      );
      await act(async () => {
        await Promise.resolve();
      });
      expect(getUserMedia).not.toHaveBeenCalled();
      expect(container.querySelector("video")).toBeNull();
      const box = container.querySelector("[data-lumencast-capture]") as HTMLElement | null;
      expect(box).not.toBeNull();
      expect(box!.style.opacity).toBe("0");
    });
  });
});

describe("x-zab.capture — RC11 : tracks stopped at unmount", () => {
  it("stops every MediaStream track when the node unmounts", async () => {
    const { stream, stop } = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    // A resolver returning a real deviceId is required: without one a declared
    // deviceRef triggers PLACEHOLDER (no stream acquired, nothing to stop).
    const resolveCaptureDevice = vi.fn().mockReturnValue({ deviceId: "phys-cam" });
    await withMediaDevices({ getUserMedia } as never, async () => {
      await renderWithRuntime(
        {
          kind: "x-zab.capture",
          id: "cam",
          props: { "x-zab.sourceKind": "media.webcam", "x-zab.deviceRef": "primary-cam", width: 640, height: 360 },
        },
        resolveCaptureDevice,
      );
      await act(async () => {
        await Promise.resolve();
      });
      expect(container.querySelector("video")).not.toBeNull();
      await act(async () => root.unmount());
      expect(stop).toHaveBeenCalled();
    });
  });
});

describe("x-zab.capture — RC6 : profile published + accepted", () => {
  it("SUPPORTED_PROFILES includes x-zab.capture/1", () => {
    expect(SUPPORTED_PROFILES.has("x-zab.capture/1")).toBe(true);
  });

  it("a bundle declaring x-zab.capture/1 is not BUNDLE_INCOMPATIBLE", () => {
    expect(() => validateBundleProfiles({ profiles: ["x-zab.capture/1"] })).not.toThrow();
  });
});
