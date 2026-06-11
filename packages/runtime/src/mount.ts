// Public mount() entry — the only surface a host (browser, CEF, OBS plugin,
// iframe) interacts with. Lifecycle and contract: see RUNTIME-API.md.

import { signal } from "@preact/signals-react";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { LumencastApp } from "./app.js";
import { applyDelta } from "./state/apply-delta.js";
import { applySnapshot } from "./state/apply-snapshot.js";
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
  const bundleFetcher = createBundleFetcher({
    baseUrl,
    ...(options.resolveBundleUrl !== undefined ? { resolveUrl: options.resolveBundleUrl } : {}),
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

  const root: Root = createRoot(options.target);
  root.render(
    createElement(LumencastApp, {
      mode: options.mode,
      store,
      bundleSignal,
      statusSignal,
      crossfadeKeySignal,
      sendInput: (patches) => ws.sendInput(patches),
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
    bSignal.value = bundle;
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
