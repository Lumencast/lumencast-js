// Public surface of @lumencast/runtime-vue.
//
// Headless Lumencast client for Vue 3 apps : connect to an LSDP/1
// server, expose live leaf state through Vue refs, send input
// patches. No DOM rendering — that's the consumer's job (you bring
// your own components, this brings the data).
//
// Quickstart:
//
//   import { useLumencast } from "@lumencast/runtime-vue";
//
//   <script setup lang="ts">
//   const { state, status, send } = useLumencast({
//     url: "wss://api.example.com/lsdp.v1",
//     token: "operator-token",
//   });
//   </script>
//
//   <template>
//     <div>Status: {{ status }}</div>
//     <div>Count: {{ state["count"] ?? 0 }}</div>
//   </template>

import { ref, shallowRef, onScopeDispose, computed, type Ref, type ComputedRef } from "vue";
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
 * Live Lumencast handle returned by `useLumencast()`. The two refs
 * are reactive ; consumers read them directly in `<script setup>` or
 * `<template>`.
 */
export interface LumencastVue {
  /** Live leaf-state map. Keyed by canonical leaf path. */
  readonly state: Ref<LeafState>;
  /** Connection status — `"disconnected" | "connecting" | "live"`. */
  readonly status: Ref<Status>;
  /** Send one or more input patches to the server. No-op when offline. */
  send(patches: Patch[]): void;
  /** Tear down the connection. Idempotent. Auto-called via `onScopeDispose`. */
  dispose(): void;
}

/**
 * Composition API hook : open a long-lived Lumencast subscription.
 *
 * The connection auto-reconnects on close with exponential backoff.
 * Disposal is wired to `onScopeDispose` so a component unmount cleans
 * up automatically — but you can also call `dispose()` manually if
 * the lifecycle is non-component (Pinia store, plugin, etc.).
 */
export function useLumencast(opts: ClientOptions): LumencastVue {
  const state = shallowRef<LeafState>({});
  const status = ref<Status>("disconnected");

  const client = createClient(opts, {
    onStatus: (s) => {
      status.value = s;
    },
    onState: (s) => {
      state.value = s;
    },
  });

  const dispose = (): void => {
    client.dispose();
  };

  onScopeDispose(dispose);

  return {
    state,
    status,
    send: client.send,
    dispose,
  };
}

/**
 * Convenience helper : derive a single leaf path as a `ComputedRef<T | undefined>`.
 */
export function useLeaf<T = unknown>(
  handle: LumencastVue,
  path: string,
): ComputedRef<T | undefined> {
  return computed(() => handle.state.value[path] as T | undefined);
}
