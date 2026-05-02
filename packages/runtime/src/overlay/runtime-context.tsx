import { createContext, useContext, type ReactNode } from "react";
import type { Patch } from "@lumencast/protocol";
import type { Store } from "../state/store";
import type { RenderBundle } from "../render/bundle";
import type { ConnectionStatus } from "../transport/ws";
import type { LumencastMode } from "../types";

export interface LumencastRuntime {
  mode: LumencastMode;
  store: Store;
  bundle: RenderBundle;
  status: ConnectionStatus;
  /** Send LSDP/1 input patches to the server. */
  sendInput: (patches: Patch[]) => void;
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
