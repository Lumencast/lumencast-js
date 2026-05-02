// Recursive tree renderer — resolves bindings, dispatches to
// primitives, handles `repeat` specially.

import { useSignals } from "@preact/signals-react/runtime";
import { useMemo, type ReactNode } from "react";
import type { Store } from "../state/store";
import type { Transition } from "../animate/transitions";
import { PRIMITIVES } from "./primitives";
import { PathScopeProvider, scopedPath, usePathScope } from "./scope";
import type { RenderNode } from "./bundle";

export interface TreeProps {
  node: RenderNode;
  store: Store;
}

export function Tree({ node, store }: TreeProps): ReactNode {
  if (node.kind === "repeat") {
    return <Repeat node={node} store={store} />;
  }
  return <Node node={node} store={store} />;
}

function Node({ node, store }: TreeProps): ReactNode {
  // useSignals() lets the surrounding component subscribe to any
  // signal read during render. Each leaf path has its own signal so
  // re-renders only fire on touched paths.
  useSignals();
  const scope = usePathScope();

  // Hooks must run unconditionally — the early-return for unknown
  // kinds happens *after* every hook has fired.
  const resolved = useMemo(
    () => resolveProps(node, store, scope),
    // We re-build per render — signals re-render cheaply, and the
    // resolution itself is O(bindings) which is small. The memo is a
    // micro-optimisation to keep object identity stable across renders
    // when the inputs haven't changed.
    [node, store, scope, ...readBindingValues(node, store, scope)],
  );

  const Primitive = PRIMITIVES[node.kind as keyof typeof PRIMITIVES];
  if (!Primitive) {
    if (import.meta.env.DEV) {
      console.warn(`[lumencast] unknown render kind : ${node.kind}`);
    }
    return null;
  }

  const transitionFor = (key: string): Transition | undefined => {
    // Per-binding default declared in the bundle. LSDP/1 does not carry per-
    // patch transitions on the wire, so this is the only source.
    return node.transitions?.[key];
  };

  const children = node.children?.map((child, idx) => (
    <Tree key={child.id ?? idx} node={child} store={store} />
  ));

  return (
    <Primitive resolved={resolved} transitionFor={transitionFor}>
      {children}
    </Primitive>
  );
}

function Repeat({ node, store }: TreeProps): ReactNode {
  useSignals();
  const scope = usePathScope();

  const itemsBinding = node.bindings?.items;
  const items =
    itemsBinding === undefined
      ? []
      : ((store.signal(scopedPath(scope, itemsBinding)).value as unknown[] | undefined) ?? []);
  if (!Array.isArray(items)) return null;

  const template = node.children?.[0];
  if (!template) return null;

  return (
    <>
      {items.map((_item, idx) => (
        <PathScopeProvider key={idx} prefix={`${itemsBinding ?? ""}.${idx}`}>
          <Tree node={template} store={store} />
        </PathScopeProvider>
      ))}
    </>
  );
}

function resolveProps(node: RenderNode, store: Store, scope: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(node.props ?? {}) };
  if (node.bindings) {
    for (const [propKey, path] of Object.entries(node.bindings)) {
      const fullPath = scopedPath(scope, path);
      out[propKey] = store.signal(fullPath).value;
    }
  }
  return out;
}

/** Helper for the useMemo deps array — read each bound signal so the
 *  memo invalidates when any binding moves. */
function readBindingValues(node: RenderNode, store: Store, scope: string): unknown[] {
  if (!node.bindings) return [];
  const values: unknown[] = [];
  for (const path of Object.values(node.bindings)) {
    values.push(store.signal(scopedPath(scope, path)).value);
  }
  return values;
}
