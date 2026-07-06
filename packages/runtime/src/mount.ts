// Public mount() entry — the only surface a host (browser, CEF, OBS plugin,
// iframe) interacts with. Lifecycle and contract: see RUNTIME-API.md.

import { signal } from "@preact/signals-react";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { LumencastApp } from "./app.js";
import { applyDelta } from "./state/apply-delta.js";
import { applySnapshot } from "./state/apply-snapshot.js";
import { createReservedLeafObserver } from "./state/reserved-leaves.js";
import { createStore } from "./state/store.js";
import { createBundleFetcher, type BundleFetcher, type RenderBundle } from "./render/bundle.js";
import { WsClient, type ConnectionStatus, type TransportError } from "./transport/ws.js";
import { validateOptions } from "./internal/validate-options.js";
import { addDiagnosticsHandler } from "./render/diagnostics.js";
import type { LumencastError, LumencastHandle, LumencastToken, MountOptions } from "./types.js";

export function mount(options: MountOptions): LumencastHandle {
  validateOptions(options);
  options.onStatus?.("disconnected");

  const store = createStore();
  const baseUrl = deriveBaseUrl(options.serverUrl);
  // The render-bundle endpoint is auth-gated like the LSDP/1 WS. Resolve the
  // current session token per fetch (mirrors `setToken`) so each bundle GET
  // carries `Authorization: Bearer <token>`. `ws` is assigned below; the
  // closure runs only at fetch time, after assignment.
  const bundleFetcher = createBundleFetcher({
    baseUrl,
    ...(options.resolveBundleUrl !== undefined ? { resolveUrl: options.resolveBundleUrl } : {}),
    getAuthToken: () => ws.resolveCurrentToken(),
  });

  const bundleSignal = signal<RenderBundle | null>(null);
  const statusSignal = signal<ConnectionStatus>("disconnected");
  const crossfadeKeySignal = signal<string>("__initial__");

  const setStatus = (status: ConnectionStatus): void => {
    statusSignal.value = status;
    options.onStatus?.(status);
  };

  const reportError = (err: LumencastError): void => {
    options.onError?.(err);
  };

  let active = true;

  // Render-bundle versions already warmed (or warming) by the preload path.
  // Keeps both roster sources (the `scene_roster` frame and the `preloadRoster`
  // mount option) idempotent — a version is fetched by the warmer at most once.
  const warmedVersions = new Set<string>();

  // ADR Blue 009 §3.2–3.3 — surface the reserved `__cam.*` LSDP leaves (the
  // slot→peer assignments + the receive-only viewer creds) to the host so its
  // WebRTC viewer (Solar) can drive room joins + `x-zab.meet-peer` slot re-keying.
  // The runtime never joins, holds creds, or re-keys ; it only forwards. Created
  // only when the host opts in — zero cost on the preview/headless paths.
  const reservedLeaves = options.onReservedLeaves
    ? createReservedLeafObserver(options.onReservedLeaves)
    : undefined;

  // ADR 001 §3.4 (issue #34) — anti-silent-drop diagnostics are events
  // surfaced to the host, never console logs in `broadcast` mode.
  const removeDiagnosticsHandler = options.onDiagnostic
    ? addDiagnosticsHandler(options.onDiagnostic)
    : undefined;

  const ws = new WsClient({
    url: options.serverUrl,
    token: options.token,
    ...(options.scene !== undefined ? { scene: options.scene } : {}),
    ...(options.testSession !== undefined ? { session: options.testSession } : {}),
    onStatus: setStatus,
    onSnapshot: (frame) => {
      if (!active) return;
      reservedLeaves?.onSnapshot(frame.state);
      void onSnapshot(
        bundleFetcher,
        bundleSignal,
        crossfadeKeySignal,
        frame.scene_id,
        frame.scene_version,
        () => applySnapshot(store, frame),
        reportError,
      );
      options.onMetric?.({
        name: "snapshot_received",
        scene_id: frame.scene_id,
        path_count: Object.keys(frame.state).length,
      });
    },
    onDelta: (frame) => {
      if (!active) return;
      const start = performance.now();
      applyDelta(store, frame);
      reservedLeaves?.onDelta(frame.patches);
      options.onMetric?.({
        name: "delta_applied",
        duration_ms: performance.now() - start,
      });
      options.onMetric?.({ name: "delta_received", count: 1, path_count: frame.patches.length });
    },
    onSceneChanged: (frame) => {
      if (!active) return;
      // The fresh snapshot that follows is the source of truth — it carries
      // the new scene_version, drives the bundle fetch, and flips the
      // crossfade key. Nothing eager to do here.
      options.onMetric?.({
        name: "scene_changed",
        from: bundleSignal.value?.scene_version ?? null,
        to: frame.scene_version,
      });
    },
    onSceneRoster: (frame) => {
      if (!active) return;
      // The server advertised the show roster (LSDP/1.1 `scene_roster`).
      // Warm every scene's render bundle in the background so the first switch
      // to each is a cache hit, not a blocking fetch.
      warmRoster(frame.entries, "frame");
    },
    onServerError: (frame) => {
      reportError({
        code: frame.code,
        message: frame.message,
        recoverable: frame.recoverable,
      });
    },
    onTransportError: (err) => {
      reportError(transportToLumencastError(err));
    },
  });

  ws.start();

  // Public preload surface (#87b) — warm a host-supplied roster right after
  // mount, before any switch. Same warmer + cache as the `scene_roster` frame.
  if (options.preloadRoster !== undefined && options.preloadRoster.length > 0) {
    warmRoster(options.preloadRoster, "option");
  }

  const root: Root = createRoot(options.target);
  root.render(
    createElement(LumencastApp, {
      mode: options.mode,
      store,
      bundleSignal,
      statusSignal,
      crossfadeKeySignal,
      sendInput: (patches) => ws.sendInput(patches),
      // ADR 004 §A1.3 — thread the host capture resolver to the runtime context
      // so the `x-zab.capture` primitive's ACQUIRE mode can pin a device.
      ...(options.resolveCaptureDevice !== undefined
        ? { resolveCaptureDevice: options.resolveCaptureDevice }
        : {}),
      // ADR 006 #4 — thread the host peer-stream resolver (supplied by the
      // WebRTC viewer #3) so the `media` primitive's LIVE mode can render a
      // peer's MediaStream in `srcObject`.
      ...(options.resolvePeerStream !== undefined
        ? { resolvePeerStream: options.resolvePeerStream }
        : {}),
      // ADR 006 #3 — reactive variant : the LIVE `media` node re-renders when a
      // peer connects/leaves mid-show. `createPeerViewer()` supplies it.
      ...(options.subscribePeerStream !== undefined
        ? { subscribePeerStream: options.subscribePeerStream }
        : {}),
      // Un-mute LIVE peer `<video>` so guest WebRTC audio joins the on-air /
      // recording mix. On-air / recording hosts only — never an interactive
      // editor (echo risk). Omitted → muted (current behaviour).
      ...(options.liveAudio !== undefined ? { liveAudio: options.liveAudio } : {}),
    }),
  );

  return {
    disconnect() {
      if (!active) return;
      active = false;
      removeDiagnosticsHandler?.();
      ws.close();
      root.unmount();
    },
    setToken(token: LumencastToken) {
      if (!active) return;
      ws.setToken(token);
    },
  };

  // --- helpers ----------------------------------------------------------

  /**
   * Warm the render bundles for a set of roster entries in the background.
   * Best-effort and non-blocking: each `get()` populates the fetcher's cache
   * keyed by `scene_version`, so the eventual `onSnapshot` fetch for that scene
   * is an instant cache hit. Idempotent via `warmedVersions`; the already-active
   * scene is skipped (its bundle is already loaded or in flight). A failed warm
   * is swallowed and its version released so a later roster can retry — the
   * scene still fetches on demand at switch time.
   */
  function warmRoster(
    entries: readonly { scene_id: string; scene_version: string }[],
    source: "frame" | "option",
  ): void {
    const activeVersion = bundleSignal.value?.scene_version;
    for (const { scene_id, scene_version } of entries) {
      if (scene_version === activeVersion) continue;
      if (warmedVersions.has(scene_version)) continue;
      warmedVersions.add(scene_version);
      void bundleFetcher
        .get(scene_id, scene_version)
        .then(() => {
          if (!active) return;
          options.onMetric?.({
            name: "roster_preloaded",
            scene_id,
            scene_version,
            source,
          });
        })
        .catch(() => {
          // Release so a subsequent roster advertisement can retry the warm.
          warmedVersions.delete(scene_version);
        });
    }
  }

  async function onSnapshot(
    fetcher: BundleFetcher,
    bSignal: typeof bundleSignal,
    cSignal: typeof crossfadeKeySignal,
    sceneId: string,
    sceneVersion: string,
    applyState: () => void,
    onErr: (err: LumencastError) => void,
  ): Promise<void> {
    let bundle: RenderBundle;
    try {
      bundle = await fetcher.get(sceneId, sceneVersion);
    } catch (err) {
      onErr({
        code: "BUNDLE_FETCH_FAILED",
        message: err instanceof Error ? err.message : "render bundle fetch failed",
        recoverable: true,
      });
      return;
    }
    if (!active) return;
    applyState();
    // ADR 013 (Prism, issue #95) — apply the host's pure root transform once,
    // before this bundle's first paint. A new bundle object carries the
    // transformed root so the cached bundle stays pristine (a scene switch
    // re-transforms the original root, never an already-transformed one). The
    // transform reparents/reorders nodes without re-keying leaves, so deltas
    // keep addressing leaves by their original path on the flat store.
    const transform = options.transformRoot;
    bSignal.value = transform ? { ...bundle, root: transform(bundle.root) } : bundle;
    cSignal.value = `${sceneId}::${sceneVersion}`;
  }
}

function transportToLumencastError(err: TransportError): LumencastError {
  return {
    code: err.code,
    message: err.message,
    recoverable: err.recoverable,
  };
}

function deriveBaseUrl(wsUrl: string): string {
  // wss://<host>/lsdp/v1 → https://<host>
  // ws://<host>/lsdp/v1  → http://<host>
  try {
    const u = new URL(wsUrl);
    const httpScheme = u.protocol === "wss:" ? "https:" : "http:";
    return `${httpScheme}//${u.host}`;
  } catch {
    return "";
  }
}
