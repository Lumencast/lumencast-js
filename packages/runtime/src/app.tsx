// Top-level React component for a mounted Lumencast instance. Reads the runtime
// signals (bundle / status) and dispatches to the right mode.
//
// Per-mode code splitting: BroadcastMode / ControlMode / TestMode live in
// separate chunks loaded only when the corresponding mode is requested. A
// broadcast mount never downloads the overlay or test code — the broadcast
// chunk is the bare minimum a CEF host needs to render the scene.
//
// Crossfade: AnimatePresence freezes the props of an exiting child so its render
// tree keeps using the values it held at the moment it started exiting.

import { useSignals } from "@preact/signals-react/runtime";
import type { Signal } from "@preact/signals-react";
import { AnimatePresence, motion } from "framer-motion";
import { lazy, Suspense } from "react";
import type { Patch } from "@lumencast/protocol";
import type { Store } from "./state/store.js";
import type { RenderBundle } from "./render/bundle.js";
import type { ConnectionStatus } from "./transport/ws.js";
import { LumencastRuntimeProvider } from "./overlay/runtime-context.js";
import type { ResolveCaptureDevice } from "./render/primitives/capture.js";
import type { ResolvePeerStream, SubscribePeerStream } from "./render/primitives/media.js";
import type { LumencastMode } from "./types.js";

const LazyBroadcastMode = lazy(() =>
  import("./modes/broadcast.js").then((m) => ({ default: m.BroadcastMode })),
);
const LazyControlMode = lazy(() =>
  import("./modes/control.js").then((m) => ({ default: m.ControlMode })),
);
const LazyTestMode = lazy(() => import("./modes/test.js").then((m) => ({ default: m.TestMode })));

export interface LumencastAppProps {
  mode: LumencastMode;
  store: Store;
  bundleSignal: Signal<RenderBundle | null>;
  statusSignal: Signal<ConnectionStatus>;
  crossfadeKeySignal: Signal<string>;
  sendInput: (patches: Patch[]) => void;
  /** ADR 004 §A1.3 — host resolver for `x-zab.capture` ACQUIRE mode. */
  resolveCaptureDevice?: ResolveCaptureDevice;
  /** ADR 006 #4 — host resolver for the `media` primitive's LIVE mode. */
  resolvePeerStream?: ResolvePeerStream;
  /** ADR 006 #3 — reactive peer-stream channel (preferred over the resolver). */
  subscribePeerStream?: SubscribePeerStream;
  /** Un-mute LIVE peer `<video>` so guest WebRTC audio joins the on-air mix.
   *  On-air / recording hosts only (echo risk in an interactive editor). */
  liveAudio?: boolean;
}

export function LumencastApp({
  mode,
  store,
  bundleSignal,
  statusSignal,
  crossfadeKeySignal,
  sendInput,
  resolveCaptureDevice,
  resolvePeerStream,
  subscribePeerStream,
  liveAudio,
}: LumencastAppProps) {
  useSignals();

  const bundle = bundleSignal.value;
  const status = statusSignal.value;
  const trackKey = crossfadeKeySignal.value;
  if (!bundle) return null;

  const ModeComponent =
    mode === "broadcast" ? LazyBroadcastMode : mode === "control" ? LazyControlMode : LazyTestMode;

  return (
    <AnimatePresence mode="sync">
      <motion.div
        key={trackKey}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4, ease: "easeInOut" }}
        style={{ position: "absolute", inset: 0 }}
      >
        <LumencastRuntimeProvider
          value={{
            mode,
            store,
            bundle,
            status,
            sendInput,
            ...(resolveCaptureDevice !== undefined ? { resolveCaptureDevice } : {}),
            ...(resolvePeerStream !== undefined ? { resolvePeerStream } : {}),
            ...(subscribePeerStream !== undefined ? { subscribePeerStream } : {}),
            ...(liveAudio !== undefined ? { liveAudio } : {}),
          }}
        >
          <Suspense fallback={null}>
            <ModeComponent />
          </Suspense>
        </LumencastRuntimeProvider>
      </motion.div>
    </AnimatePresence>
  );
}
