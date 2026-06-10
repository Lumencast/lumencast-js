// Recursive tree renderer — resolves bindings, dispatches to
// primitives, handles `repeat` specially.

import { useSignals } from "@preact/signals-react/runtime";
import { motion } from "framer-motion";
import { useMemo, type ReactNode } from "react";
import type { Store } from "../state/store";
import type { Transition } from "../animate/transitions";
import { PRIMITIVES } from "./primitives";
import { PathScopeProvider, scopedPath, usePathScope } from "./scope";
import type { RenderNode } from "./bundle";
import { UniversalWrapper, type SizingMode } from "./universal-wrapper";
import { KeyframePlayer } from "./keyframe-player";
import { StaggerContext, computeStaggerDelayMs } from "./stagger-context";
import { useBindAnimate } from "./bind-animate";

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

  // LSML 1.1 §6.3 — bindAnimate : continuous interpolation toward live
  // leaf values, no remount (issue #33). Scalar channels ride motion
  // values on a wrapping motion.div ; colour channels (§6.5) flow back
  // into the primitive's resolved prop as interpolated, re-validated
  // colour strings.
  const bindAnimate = useBindAnimate(node, store, scope);

  const Primitive = PRIMITIVES[node.kind as keyof typeof PRIMITIVES];
  if (!Primitive) {
    if (import.meta.env.DEV) {
      console.warn(`[lumencast] unknown render kind : ${node.kind}`);
    }
    return null;
  }

  // LSDP/1.1 §3.2.2 — a per-leaf transition on the most recent delta
  // takes precedence over the bundle-level default. Only bound props
  // can carry a wire transition (a static prop never moves). Snapshots
  // clear the directive, so the bundle default reapplies after a reset.
  //
  // We resolve here in the parent's render (useSignals() above tracks
  // these reads) rather than inside the primitive's callback — that way
  // a transition signal change re-renders this Node, which in turn re-
  // renders the primitive with the new transition prop.
  const liveTransitions: Record<string, Transition | undefined> = {};
  if (node.bindings) {
    for (const [key, path] of Object.entries(node.bindings)) {
      const ts = store.transitionSignal(scopedPath(scope, path)).value;
      if (ts !== undefined) liveTransitions[key] = ts;
    }
  }
  const transitionFor = (key: string): Transition | undefined => {
    if (key in liveTransitions) return liveTransitions[key];
    return node.transitions?.[key];
  };

  const children = node.children?.map((child, idx) => (
    <Tree key={child.id ?? idx} node={child} store={store} />
  ));

  // LSML 1.1 §5.4 — universal props applied uniformly across all
  // primitives. Pulled out of `resolved` so primitives can ignore
  // them ; the wrapper composes with whatever transform/opacity the
  // primitive's own framer-motion may apply.
  const universal = {
    visible: typeof resolved.visible === "boolean" ? resolved.visible : undefined,
    opacity:
      typeof resolved.universal_opacity === "number" ? resolved.universal_opacity : undefined,
    rotation: typeof resolved.rotation === "number" ? resolved.rotation : undefined,
    sizing: extractSizing(resolved.sizing),
  };

  // Merge live-interpolated colour values (§6.5) over the resolved
  // props — the primitive re-validates them through `parseCssColor`.
  const resolvedWithColors =
    Object.keys(bindAnimate.colorProps).length > 0
      ? { ...resolved, ...bindAnimate.colorProps }
      : resolved;

  let body = (
    <UniversalWrapper {...universal}>
      <Primitive
        resolved={resolvedWithColors}
        transitionFor={transitionFor}
        animateInitial={node.animate_initial}
      >
        {children}
      </Primitive>
    </UniversalWrapper>
  );

  // Scalar bindAnimate channels apply on a wrapping motion.div (same
  // composition model as UniversalWrapper). Motion values mutate the
  // style directly — zero React re-render per frame on the hot path.
  if (bindAnimate.motionStyle) {
    body = (
      <motion.div data-lumencast-bind-animate={node.id ?? ""} style={bindAnimate.motionStyle}>
        {body}
      </motion.div>
    );
  }

  // LSML 1.1 §6.6 — when a primitive declares keyframes, wrap the
  // rendered subtree in a player that drives framer-motion through the
  // step path. The player handles replay-on-key-change and reads any
  // ambient stagger delay from StaggerContext (§6.7).
  if (node.keyframes) {
    return (
      <KeyframePlayer keyframes={node.keyframes} store={store}>
        {body}
      </KeyframePlayer>
    );
  }
  return body;
}

function extractSizing(value: unknown): { x?: SizingMode; y?: SizingMode } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const obj = value as { x?: unknown; y?: unknown };
  const out: { x?: SizingMode; y?: SizingMode } = {};
  if (obj.x === "fixed" || obj.x === "hug" || obj.x === "fill") out.x = obj.x;
  if (obj.y === "fixed" || obj.y === "hug" || obj.y === "fill") out.y = obj.y;
  return out.x !== undefined || out.y !== undefined ? out : undefined;
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

  // LSML 1.1 §6.7 — `stagger_ms` produces wave-like reveals across
  // iterations. We compute the per-iteration delay (capped) and feed
  // it to descendants via StaggerContext so the KeyframePlayer (and
  // future animate-aware primitives) can pick it up without per-
  // iteration scripting. `stagger_ms: 0` (or unset) is a no-op.
  const staggerMs = typeof node.stagger_ms === "number" ? node.stagger_ms : 0;

  return (
    <>
      {items.map((_item, idx) => {
        const delayMs = computeStaggerDelayMs(idx, staggerMs);
        const tree = (
          <PathScopeProvider key={idx} prefix={`${itemsBinding ?? ""}.${idx}`}>
            <Tree node={template} store={store} />
          </PathScopeProvider>
        );
        if (delayMs <= 0) return tree;
        return (
          <StaggerContext.Provider key={idx} value={delayMs}>
            {tree}
          </StaggerContext.Provider>
        );
      })}
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
