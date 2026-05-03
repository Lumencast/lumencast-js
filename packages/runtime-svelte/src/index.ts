// Public surface of @lumencast/runtime-svelte.
//
// Headless Lumencast client for Svelte apps : connect to an LSDP/1
// server, expose live leaf state through Svelte stores, send input
// patches. No DOM rendering — that's the consumer's job (you bring
// your own components, this brings the data).
//
// Quickstart:
//
//   import { lumencast } from "@lumencast/runtime-svelte";
//
//   const live = lumencast({
//     url: "wss://api.example.com/lsdp.v1",
//     token: "operator-token",
//   });
//
//   // In a Svelte 4 / 5 component :
//   $: count = $live.state["count"] ?? 0;
//   $: status = $live.status;
//   live.send([{ path: "__inputs.title", value: "Hello" }]);
//   onDestroy(() => live.dispose());

import { writable, derived, type Readable, type Writable } from "svelte/store";
import {
  createClient,
  type ClientOptions,
  type LeafState,
  type Status,
} from "./_internal/client.js";
import type { Patch } from "@lumencast/protocol";

export type { LeafState, Status, ClientOptions };
export type { Patch } from "@lumencast/protocol";

/**
 * The live Lumencast handle returned by `lumencast()`. The two stores
 * are reactive ; consumers subscribe via Svelte's `$store` syntax.
 */
export interface LumencastSvelte {
  /** Live leaf-state map. Keyed by canonical leaf path. */
  readonly state: Readable<LeafState>;
  /** Connection status — `"disconnected" | "connecting" | "live"`. */
  readonly status: Readable<Status>;
  /** Send one or more input patches to the server. No-op when offline. */
  send(patches: Patch[]): void;
  /** Tear down the connection. Idempotent. */
  dispose(): void;
}

/**
 * Open a long-lived Lumencast subscription.
 *
 * Returns a handle whose `state` and `status` are Svelte readables.
 * The connection auto-reconnects on close with exponential backoff.
 * Call `dispose()` from `onDestroy()` to clean up.
 */
export function lumencast(opts: ClientOptions): LumencastSvelte {
  const stateStore: Writable<LeafState> = writable({});
  const statusStore: Writable<Status> = writable("disconnected");

  const client = createClient(opts, {
    onStatus: (s) => statusStore.set(s),
    onState: (s) => stateStore.set(s),
  });

  return {
    state: { subscribe: stateStore.subscribe },
    status: { subscribe: statusStore.subscribe },
    send: client.send,
    dispose: client.dispose,
  };
}

/**
 * Convenience helper : derive a single leaf path as a `Readable<T>`.
 * Equivalent to `derived(handle.state, ($s) => $s[path] as T | undefined)`.
 */
export function leaf<T = unknown>(handle: LumencastSvelte, path: string): Readable<T | undefined> {
  return derived(handle.state, ($s) => $s[path] as T | undefined);
}
