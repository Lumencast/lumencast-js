import { createContext, useContext, type ReactNode } from "react";
import type { Patch } from "@lumencast/protocol";
import type { Store } from "../state/store";
import type { RenderBundle } from "../render/bundle";
import type { ConnectionStatus } from "../transport/ws";
import type { LumencastMode } from "../types";
import type { ResolveCaptureDevice } from "../render/primitives/capture";

export interface LumencastRuntime {
  mode: LumencastMode;
  store: Store;
  bundle: RenderBundle;
  status: ConnectionStatus;
  /** Send LSDP/1 input patches to the server. */
  sendInput: (patches: Patch[]) => void;
  /** ADR 004 §A1.3 — host-provided resolver mapping a LOGICAL `deviceRef` to a
   *  physical `deviceId` for the `x-zab.capture` primitive's ACQUIRE mode.
   *  Injected from `MountOptions`, NOT the bundle. Absent → default device. */
  resolveCaptureDevice?: ResolveCaptureDevice;
}

const Ctx = createContext<LumencastRuntime | null>(null);

export function LumencastRuntimeProvider({
  value,
  children,
}: {
  value: LumencastRuntime;
  children: ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLumencastRuntime(): LumencastRuntime {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error(
      "Lumencast overlay components must be rendered inside LumencastRuntimeProvider",
    );
  }
  return v;
}

/** Read the runtime context WITHOUT throwing when no provider is mounted.
 *  Render primitives (e.g. `x-zab.capture`) may render via `<Tree>` directly —
 *  embedded hosts, tooling, tests — outside `mount()`'s provider. They use this
 *  to pick up mount-level host config (the capture resolver) when present and
 *  fall back to defaults when not. */
export function useOptionalLumencastRuntime(): LumencastRuntime | null {
  return useContext(Ctx);
}
