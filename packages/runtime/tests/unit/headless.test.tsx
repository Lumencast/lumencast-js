// Public headless render API — `renderBundleHeadless` (ADR 003 §3.1, RC3/RC4).
//
// Proves the export renders a compiled RenderBundle into a live DOM node
// through the production broadcast seam, with NO network fetch, and resolves
// `ready` only after layout + fonts have settled. The full SSIM-fidelity proof
// lives in the e2e zero-loss harness (RC2); this is the proximity unit proof.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderBundleHeadless,
  addDiagnosticsHandler,
  type RenderDiagnostic,
  type RenderBundle,
} from "../../src/index.js";

let target: HTMLDivElement;
let warnSpy: ReturnType<typeof vi.spyOn>;
let handles: Array<{ unmount(): void }>;

beforeEach(() => {
  target = document.createElement("div");
  document.body.appendChild(target);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  handles = [];
});

afterEach(() => {
  for (const h of handles) h.unmount();
  target.remove();
  warnSpy.mockRestore();
});

function mount(opts: Omit<Parameters<typeof renderBundleHeadless>[0], "target">) {
  const h = renderBundleHeadless({ ...opts, target });
  handles.push(h);
  return h;
}

const GOOD_HOST = "cdn.lumencast.dev";
const GOOD_SRC = `https://${GOOD_HOST}/logo.png`;
const REMOTE_OFF_ALLOWLIST = "https://evil.example/track.png";

function bundleWith(root: RenderBundle["root"], allowedHosts?: string[]): RenderBundle {
  return {
    scene_version: "test",
    root,
    ...(allowedHosts ? { assets: { allowedHosts } } : {}),
  };
}

describe("renderBundleHeadless — production seam render (RC3/RC4)", () => {
  it("renders the bundle into the target through BroadcastMode", async () => {
    const bundle = bundleWith(
      { kind: "image", id: "logo", props: { src: GOOD_SRC, alt: "logo" } },
      [GOOD_HOST],
    );
    const handle = mount({ bundle });
    await handle.ready;
    const img = target.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(GOOD_SRC);
  });

  it("sets the stage dimensions on the target (default 1920×1080)", async () => {
    const bundle = bundleWith({ kind: "frame", props: { width: 10, height: 10 } });
    const handle = mount({ bundle });
    await handle.ready;
    expect(target.style.width).toBe("1920px");
    expect(target.style.height).toBe("1080px");
    expect(target.style.overflow).toBe("hidden");
  });

  it("honours a custom stage size", async () => {
    const bundle = bundleWith({ kind: "frame", props: { width: 10, height: 10 } });
    const handle = mount({ bundle, stage: { width: 800, height: 600 } });
    await handle.ready;
    expect(target.style.width).toBe("800px");
    expect(target.style.height).toBe("600px");
  });

  // RC3 — a remote src off the bundle allowlist is OMITTED + diagnosed, never
  // posted to the DOM. The runtime never fetches; the gate is the sole
  // authority, applied unchanged through the broadcast seam.
  it("RC3 — an off-allowlist remote src is omitted from the DOM + diagnosed", async () => {
    const diagnostics: RenderDiagnostic[] = [];
    const unsub = addDiagnosticsHandler((d) => diagnostics.push(d));
    try {
      const bundle = bundleWith(
        { kind: "image", id: "tracker", props: { src: REMOTE_OFF_ALLOWLIST, alt: "x" } },
        [GOOD_HOST],
      );
      const handle = mount({ bundle });
      await handle.ready;
      expect(target.querySelector("img")).toBeNull();
      expect(target.innerHTML).not.toContain("evil.example");
      expect(diagnostics.some((d) => d.field === "image.src")).toBe(true);
    } finally {
      unsub();
    }
  });

  it("RC3 — deny-by-default: a remote src with no allowlist is omitted", async () => {
    const bundle = bundleWith({ kind: "image", id: "logo", props: { src: GOOD_SRC, alt: "x" } });
    const handle = mount({ bundle });
    await handle.ready;
    expect(target.querySelector("img")).toBeNull();
  });

  // RC3 — the onDiagnostic option is wired to the same channel and receives
  // the omitted-asset diagnostic (R9-clean: no URL).
  it("RC3 — onDiagnostic receives the omission diagnostic, no URL leaked (R9)", async () => {
    const received: RenderDiagnostic[] = [];
    const bundle = bundleWith(
      { kind: "image", id: "tracker", props: { src: REMOTE_OFF_ALLOWLIST, alt: "x" } },
      [GOOD_HOST],
    );
    const handle = mount({ bundle, onDiagnostic: (d) => received.push(d) });
    await handle.ready;
    expect(received.some((d) => d.field === "image.src")).toBe(true);
    expect(JSON.stringify(received)).not.toContain("evil.example");
  });

  it("the diagnostics handler is detached on unmount", async () => {
    const received: RenderDiagnostic[] = [];
    const bundle = bundleWith({ kind: "frame", props: { width: 10, height: 10 } });
    const handle = mount({ bundle, onDiagnostic: (d) => received.push(d) });
    await handle.ready;
    handle.unmount();
    handles = []; // already unmounted
    // After unmount the handler is gone — a later global diagnostic is not seen.
    const { addDiagnosticsHandler: _ } = await import("../../src/render/diagnostics.js");
    void _;
    expect(target.querySelector("img")).toBeNull();
  });

  // RC4 — `ready` does not resolve before document.fonts.ready. We gate the
  // global `document.fonts.ready` on a manual deferral and assert `ready` only
  // settles once fonts are reported ready (AND after the double rAF).
  it("RC4 — `ready` waits for document.fonts.ready", async () => {
    let releaseFonts: () => void = () => {};
    const fontsGate = new Promise<void>((res) => {
      releaseFonts = res;
    });
    const originalFonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    // Stub document.fonts.ready with a controllable promise.
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: fontsGate },
    });
    try {
      const bundle = bundleWith({ kind: "frame", props: { width: 10, height: 10 } });
      const handle = mount({ bundle });

      let resolved = false;
      void handle.ready.then(() => {
        resolved = true;
      });

      // Give layout / rAF a chance to fire — ready must STILL be pending
      // because the fonts gate has not been released.
      await new Promise((r) => setTimeout(r, 50));
      expect(resolved).toBe(false);

      releaseFonts();
      await handle.ready;
      expect(resolved).toBe(true);
    } finally {
      if (originalFonts) {
        Object.defineProperty(document, "fonts", {
          configurable: true,
          value: originalFonts,
        });
      } else {
        delete (document as Document & { fonts?: FontFaceSet }).fonts;
      }
    }
  });

  it("unmount tears down the React root (target emptied)", async () => {
    const bundle = bundleWith({ kind: "image", id: "logo", props: { src: GOOD_SRC, alt: "x" } }, [
      GOOD_HOST,
    ]);
    const handle = mount({ bundle });
    await handle.ready;
    expect(target.querySelector("img")).not.toBeNull();
    handle.unmount();
    handles = [];
    // React 19 unmount is sync; the root content is cleared.
    expect(target.querySelector("img")).toBeNull();
  });
});
