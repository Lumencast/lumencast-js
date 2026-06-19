// Public headless render entry — render an already-compiled `RenderBundle`
// into a live DOM node, no WebSocket, ready when layout + fonts have settled
// (ADR 003 §3.1). The host (Playwright / Chromium / a CEF offscreen surface)
// screenshots `target` once `ready` resolves. The runtime does DOM + readiness
// ONLY — no screenshot, no fetch (ADR 003 D5/D3).
//
// This is the zero-loss harness (ADR 002 #J) generalised: it mounts the EXACT
// production seam —
//   LumencastRuntimeProvider{ mode:"broadcast", status:"live" } > BroadcastMode
// — into a real `createRoot(target)`, NOT `renderToStaticMarkup` (which yields
// unlaid-out markup: unmeasured fonts, uncomposited masks → an infidel PNG,
// ADR 003 §3.1). `BroadcastMode` is dynamically imported so the headless
// function adds no weight to the eager `mount`/broadcast path (ADR 003 §4,
// RC6); the heavy render code already lives in the broadcast/tree chunks.
//
// Asset resolution is the HOST's job, done in the bundle BEFORE this call
// (ADR 003 §3.2): the runtime renders the bundle as-is, gating every remaining
// `src` through the unchanged deny-by-default host-allow gate inside
// `BroadcastMode` (`AllowedHostsProvider`). A `src` on a host not in the
// bundle's `allowedHosts` is omitted + a diagnostic is emitted — never faked
// (ADR 002 borne, D4). Use `render/asset-resolve` helpers to pre-resolve.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createStore } from "../state/store.js";
import { LumencastRuntimeProvider } from "../overlay/runtime-context.js";
import { addDiagnosticsHandler, type DiagnosticHandler } from "./diagnostics.js";
import type { RenderBundle } from "./bundle.js";

/** Default stage size — the Figma 817:3 cover frame, the SSIM reference. */
const DEFAULT_STAGE = { width: 1920, height: 1080 } as const;

export interface HeadlessRenderOptions {
  /** Already-compiled bundle (via `@lumencast/compiler` on the host side). */
  bundle: RenderBundle;
  /** A live, mounted DOM node. Its size is set from `stage` unless the host
   *  has already dimensioned it (see `stage`). */
  target: HTMLElement;
  /** Initial leaf-grain store state (`store.reset(defaults)`) — the bound
   *  values the bundle reads (`__lit.*`, score, names…). */
  defaults?: Record<string, unknown>;
  /** Stage dimensions in CSS px. Defaults to 1920×1080. Applied to `target`
   *  as `width`/`height`/`position:relative`/`overflow:hidden` so the
   *  screenshot frame matches the reference exactly. */
  stage?: { width: number; height: number };
  /** Anti-drop diagnostics channel (ADR 001 §3.4): omitted assets, unhonoured
   *  fields surface here as `{ nodeId, field, reason }` (never a value — R9).
   *  Wired to the same global channel `mount()` uses. */
  onDiagnostic?: DiagnosticHandler;
}

export interface HeadlessRenderHandle {
  /** Resolves after the scene has rendered, two animation frames have passed
   *  AND `document.fonts.ready` (ADR 003 §3.3) — i.e. the DOM is laid out and
   *  fonts are loaded, so a screenshot taken now is fidelity-faithful. */
  ready: Promise<void>;
  /** Tear down the React root and detach the diagnostics handler. */
  unmount(): void;
}

const noop = (): void => {};

/**
 * Render `bundle` into `target` through the production broadcast path and
 * resolve `ready` once it is settled. The runtime performs NO network fetch and
 * takes NO screenshot — it produces a settled live DOM and a readiness signal,
 * nothing more (ADR 003 D5).
 */
export function renderBundleHeadless(opts: HeadlessRenderOptions): HeadlessRenderHandle {
  const stage = opts.stage ?? DEFAULT_STAGE;
  const target = opts.target;
  // Pose the stage so the screenshot frame is exact (mirrors harness.html).
  target.style.position ||= "relative";
  target.style.width = `${stage.width}px`;
  target.style.height = `${stage.height}px`;
  target.style.overflow = "hidden";

  const removeDiagnostics = opts.onDiagnostic
    ? addDiagnosticsHandler(opts.onDiagnostic)
    : undefined;

  const store = createStore();
  store.reset(opts.defaults ?? {});

  const root = createRoot(target);

  const ready = new Promise<void>((resolve) => {
    // BroadcastMode is dynamically imported so its (and the tree's) weight is
    // not pulled into the eager `mount` entry chunk (RC6). It is already a
    // separate chunk reused from the broadcast path.
    void import("../modes/broadcast.js").then(({ BroadcastMode }) => {
      root.render(
        <StrictMode>
          <LumencastRuntimeProvider
            value={{
              mode: "broadcast",
              store,
              bundle: opts.bundle,
              status: "live",
              sendInput: noop,
            }}
          >
            <BroadcastMode />
          </LumencastRuntimeProvider>
        </StrictMode>,
      );

      // Settle: two animation frames (layout) AND fonts loaded (ADR 003 §3.3).
      // Both must complete before `ready` resolves, so a screenshot taken on
      // `ready` uses the brand glyphs, not the fallback font (no FOUT freeze).
      const framesSettled = new Promise<void>((res) => {
        requestAnimationFrame(() => requestAnimationFrame(() => res()));
      });
      const fontsReady =
        typeof document !== "undefined" && document.fonts
          ? document.fonts.ready.then(() => undefined)
          : Promise.resolve();
      void Promise.all([framesSettled, fontsReady]).then(() => resolve());
    });
  });

  return {
    ready,
    unmount() {
      removeDiagnostics?.();
      root.unmount();
    },
  };
}
