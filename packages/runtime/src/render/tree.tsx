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
import { UniversalWrapper, type SizingMode, type UniversalProps } from "./universal-wrapper";
import { KeyframePlayer } from "./keyframe-player";
import { StaggerContext, computeStaggerDelayMs } from "./stagger-context";
import { useBindAnimate } from "./bind-animate";
import { checkNodeProps } from "./prop-allowlist";
import { emitDiagnostic } from "./diagnostics";
import { buildMask, parseMaskSpec, MASK_FEATHER_PAD } from "./mask";
import { parseBlendMode } from "./blend-mode";
import { useAllowedHosts } from "./allowed-hosts";
import { useShapeIndex } from "./shape-index";
import {
  buildMaskCoverageFromShape,
  buildMaskCoverageFromGroup,
  coverageIsFeathered,
} from "./shape-geometry";

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
  // ADR 002 §3.2 (#E) — the bundle's host allowlist, for gating an image
  // mask source (T1/T2). `undefined` = deny every remote host.
  const allowedHosts = useAllowedHosts();
  // ADR 002 A2.1 (#K) — the bundle-wide `id → shape` index, for resolving a
  // `mask.source.kind:"shape"` ref to inlined coverage geometry.
  const shapeIndex = useShapeIndex();

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

  // ADR 001 §3.4 (issue #34) — audit static props + binding keys
  // against the primitive's allowlist ; unknown props diagnose instead
  // of dropping silently. Key sets are static per node (a live delta
  // can only change values), so the check is once-per-node.
  checkNodeProps(node);

  const Primitive = PRIMITIVES[node.kind as keyof typeof PRIMITIVES];
  if (!Primitive) {
    emitDiagnostic(node.id, "kind", "unknown render kind ; node not rendered");
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
  //
  // ADR 002 §3.1 (D1) — absolute placement. The compiler flattens LSML
  // `position:{x,y}` → `resolved.x`/`resolved.y` and `size:{w,h}` →
  // `resolved.width`/`resolved.height` on EVERY primitive (compile.ts
  // §universal-props). The wrapper consumes them as absolute placement,
  // EXCEPT on `frame` : a frame already positions itself (it reads
  // `x`/`y`/`width`/`height` into its own absolute box + transform), so
  // letting the wrapper pin it too would double the offset. Every other
  // kind (text/shape/image/media/instance/stack/grid) is placed by the
  // wrapper. A node without `x`/`y` gets `position: undefined` → normal
  // flow (RC#2 non-regression).
  // A masked node with a real blend hoists that blend above the mask wrapper
  // (the mask isolates an inner `mix-blend-mode`). Compute it once here so the
  // universal prop and the wrapper below agree.
  const maskHoistsBlend =
    resolved.mask !== undefined &&
    typeof resolved.blendMode === "string" &&
    parseBlendMode(resolved.blendMode) !== undefined;
  const universal = {
    visible: typeof resolved.visible === "boolean" ? resolved.visible : undefined,
    opacity:
      typeof resolved.universal_opacity === "number" ? resolved.universal_opacity : undefined,
    // A frame applies its own static rotation (frame.tsx) so it pivots around
    // its centre ; the wrapper has no box for a self-positioning frame and would
    // pivot around a collapsed (0-height) box. Non-frames keep it on the wrapper
    // (they DO carry position/size there).
    rotation:
      node.kind === "frame"
        ? undefined
        : typeof resolved.rotation === "number"
          ? resolved.rotation
          : undefined,
    // Mirror (Figma scaleY(-1)) — like rotation, a frame mirrors itself
    // (frame.tsx) ; non-frames carry it on the wrapper, composed with rotation.
    flipY: node.kind === "frame" ? undefined : resolved.flipY === true,
    blur: typeof resolved.blur === "number" ? resolved.blur : undefined,
    // ADR 014 Tier B (issue #355) — backdropBlur/noise/texture/glass are
    // consumed by the wrapper (CSS backdrop-filter / EffectOverlays), same
    // shape-narrowing rigor as `mask` below (full field validation lives in
    // the wrapper/EffectOverlays' own clamps, R8 — a malformed object here
    // degrades to "no effect", never an unbounded value reaching CSS).
    backdropBlur: typeof resolved.backdropBlur === "number" ? resolved.backdropBlur : undefined,
    noise:
      typeof resolved.noise === "object" && resolved.noise !== null
        ? (resolved.noise as UniversalProps["noise"])
        : undefined,
    texture:
      typeof resolved.texture === "object" && resolved.texture !== null
        ? (resolved.texture as UniversalProps["texture"])
        : undefined,
    glass:
      typeof resolved.glass === "object" && resolved.glass !== null
        ? (resolved.glass as UniversalProps["glass"])
        : undefined,
    sizing: extractSizing(resolved.sizing),
    position: node.kind === "frame" ? undefined : extractPosition(resolved),
    size: node.kind === "frame" ? undefined : extractSize(resolved),
    // ADR 002 §3.2 (D2 / #D) — `blendMode` is a universal prop on every
    // primitive ; the wrapper re-validates it against the closed enum
    // before applying `mix-blend-mode` (T4 runtime gate). Pass the raw
    // resolved value through ; the wrapper omits anything off the enum.
    // A blend on a MASKED node is hoisted ABOVE the mask wrapper (see below) —
    // a CSS mask forms an isolating group, so a `mix-blend-mode` left on the
    // (inner) wrapper would fold over a transparent backdrop (the caramel
    // hard-light showed the raw blue wave instead of compositing over the warm
    // gradient). Drop it here when it will be hoisted.
    blendMode:
      typeof resolved.blendMode === "string" && !maskHoistsBlend ? resolved.blendMode : undefined,
  };

  // ADR 002 §3.1 (D1) — a container holding at least one absolutely
  // positioned child must establish the containing block so the child's
  // `left/top` resolve against it (and not a distant ancestor). `Frame`
  // is already `position:absolute` ; `Stack`/`Grid` flip to
  // `position:relative` only when needed (no change for pure auto-layout
  // boards — RC#2). Threaded to the primitive so the layout container
  // decides ; a node without absolute children is untouched.
  const hasAbsoluteChild = node.children?.some(childIsAbsolute) ?? false;

  // Merge live-interpolated colour values (§6.5) over the resolved
  // props — the primitive re-validates them through `parseCssColor`.
  const resolvedWithColors =
    Object.keys(bindAnimate.colorProps).length > 0
      ? { ...resolved, ...bindAnimate.colorProps }
      : resolved;

  const primitiveEl = (
    <Primitive
      resolved={resolvedWithColors}
      nodeId={node.id}
      transitionFor={transitionFor}
      animateInitial={node.animate_initial}
      establishesContainingBlock={hasAbsoluteChild}
    >
      {children}
    </Primitive>
  );

  // ADR 002 §3.2 (#E) — a typed `mask` lowered onto the node. Build it up-front
  // so an IMAGE mask (CSS `mask-image`) can sit INSIDE the wrapper — it must
  // rotate WITH the content under the wrapper's transform, else an outer
  // un-rotated mask clips a mis-rotated crop (the caramel wave shrank off-box).
  // A group/shape SVG mask stays OUTSIDE (its coverage is authored in the parent
  // coordinate space). The mask is built ENTIRELY from typed fields (T3) ; enums
  // re-validated (T4), image source host-gated (T1/T2) before any `href`.
  let built: ReturnType<typeof buildMask> | null = null;
  if (resolved.mask !== undefined) {
    const spec = parseMaskSpec(resolved.mask, node.id);
    // #K/#O — resolve a ref to its inlined coverage geometry, routed on the
    // referenced node's `kind` (shape → own outline ; frame → visible children).
    const resolveShape = (ref: string) => {
      const target = shapeIndex.get(ref);
      if (!target) return null;
      return target.kind === "frame"
        ? buildMaskCoverageFromGroup(target, target.id)
        : buildMaskCoverageFromShape(target, target.id);
    };
    // A FEATHERED coverage (a blurred mask edge, e.g. the bg-texture ellipse) is
    // the only case that needs the wrapper feather pad. Detect it from the mask
    // SOURCE group's children so a sharp mask skips the pad entirely (no extra
    // wrapper, no structural change).
    let feather = false;
    if (spec) {
      const src = spec.source as { kind?: string; ref?: unknown };
      if ((src.kind === "group" || src.kind === "shape") && typeof src.ref === "string") {
        const t = shapeIndex.get(src.ref);
        feather = t ? coverageIsFeathered(t) : false;
      }
    }
    built = spec
      ? buildMask(spec, allowedHosts, node.id, resolveShape, extractSize(resolved), feather)
      : null;
  }
  const isImageMask =
    built !== null && built.style != null && "maskImage" in (built.style as object);

  let inner: ReactNode = primitiveEl;
  if (built && isImageMask) {
    // Image mask co-located with the content : the CSS mask-image is on a box the
    // wrapper's transform rotates, keeping its alpha aligned to the wave.
    inner = <div style={{ width: "100%", height: "100%", ...built.style }}>{inner}</div>;
  }

  let body = <UniversalWrapper {...universal}>{inner}</UniversalWrapper>;

  if (built && !isImageMask) {
    // The (group/shape) mask wrapper MUST own a real box for the CSS mask to clip
    // anything : its content is `position:absolute`, so fill the parent's
    // containing block to share the absolutely-placed body's coordinate space.
    // `overflow:hidden` bounds the (oversized) masked content to this box — the
    // CSS `mask` alone does NOT clip it (removing it leaked the 2786×1491 tile
    // group everywhere).
    // Only a FEATHERED mask grows the box (+ shifts the coverage, mask.tsx) ;
    // a sharp mask uses pad 0 → inset:0, identical to the un-padded structure.
    const pad = built.feather ? MASK_FEATHER_PAD : 0;
    body = (
      <div
        style={{
          position: "absolute",
          inset: -pad,
          overflow: "hidden",
          ...built.style,
        }}
      >
        <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
          <defs>{built.def}</defs>
        </svg>
        {/* Inner box inset by +PAD cancels the wrapper's −PAD grow for the
            CONTENT — the body keeps its original coordinates while the masked
            box (and its feathered rim) is the bigger one. */}
        <div style={{ position: "absolute", inset: pad }}>{body}</div>
      </div>
    );
  }
  // Hoist the node's blend ABOVE the wrapper+mask : an outer box carrying ONLY
  // `mix-blend-mode` (no transform / opacity / filter / mask) so it composites
  // the masked result with the SCENE backdrop. The caramel 3d-render then
  // hard-lights over the warm gradient (orange) instead of its raw image (blue).
  if (built && maskHoistsBlend) {
    const hoisted = parseBlendMode(resolved.blendMode);
    body = (
      <div
        style={{
          position: "absolute",
          inset: 0,
          mixBlendMode: hoisted as React.CSSProperties["mixBlendMode"],
        }}
      >
        {body}
      </div>
    );
  }

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
      <KeyframePlayer keyframes={node.keyframes} store={store} nodeId={node.id}>
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

function finite(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** ADR 002 §3.1 (D1) — form the absolute-placement `position:{x,y}` from
 *  the compiler-flattened `resolved.x`/`resolved.y`. BOTH axes must be
 *  finite numbers : a partial or malformed pair yields `undefined` (the
 *  node stays in the normal flow — RC#3 mistyped-position is inert, not
 *  injected). Values are plain numbers, never untrusted strings.
 *
 *  ADR 006 §3.3 — a `meet.peer` node produced DIRECTLY by the Prism from-scene
 *  export bypasses `@lumencast/compiler`, so its geometry arrives in the NESTED
 *  LSML shape (`position:{x,y}`) rather than flattened `x`/`y`. We accept that
 *  nested form as a fallback ONLY when the flat form is absent. This is purely
 *  additive : every compiled bundle always carries flat `x`/`y` (which win), so
 *  no existing node's placement changes. */
function extractPosition(resolved: Record<string, unknown>): { x: number; y: number } | undefined {
  let x = finite(resolved.x);
  let y = finite(resolved.y);
  if (x === undefined && y === undefined) {
    const nested = resolved.position as { x?: unknown; y?: unknown } | undefined;
    if (nested && typeof nested === "object") {
      x = finite(nested.x);
      y = finite(nested.y);
    }
  }
  if (x === undefined || y === undefined) return undefined;
  return { x, y };
}

/** ADR 002 §3.1 (D1) — the absolute box size from `resolved.width`/
 *  `resolved.height`. Only meaningful alongside `position` (the wrapper
 *  ignores it otherwise). Partial sizes are allowed (one axis hugs).
 *
 *  ADR 006 §3.3 — like `extractPosition`, accept the NESTED `size:{w,h}` shape
 *  as a fallback for an uncompiled `meet.peer` node (flat `width`/`height`
 *  always win when present, so compiled bundles are unaffected). Without this,
 *  the `meet.peer` wrapper got a position but NO size → the `<video>` filled a
 *  collapsed box instead of the authored geometry (the observed RC-Geo bug). */
function extractSize(resolved: Record<string, unknown>): { w?: number; h?: number } | undefined {
  let w = finite(resolved.width);
  let h = finite(resolved.height);
  if (w === undefined && h === undefined) {
    const nested = resolved.size as { w?: unknown; h?: unknown } | undefined;
    if (nested && typeof nested === "object") {
      w = finite(nested.w);
      h = finite(nested.h);
    }
  }
  if (w === undefined && h === undefined) return undefined;
  return { w, h };
}

/** True when a child node carries a finite `{x,y}` absolute position
 *  (static prop OR a bound `x`/`y`). Used by a container primitive to
 *  decide whether to establish a positioned containing block. A bound
 *  position is treated as "absolute" structurally — the key presence is
 *  static even if the value moves live. */
function childIsAbsolute(child: RenderNode): boolean {
  if (child.kind === "frame") return false; // a frame positions itself
  const props = child.props ?? {};
  const bindings = child.bindings ?? {};
  // ADR 006 §3.3 — also recognise the nested `position:{x,y}` shape (an
  // uncompiled `meet.peer` node), mirroring extractPosition's fallback.
  const nested = props.position as { x?: unknown; y?: unknown } | undefined;
  const hasX =
    finite(props.x) !== undefined ||
    "x" in bindings ||
    (nested ? finite(nested.x) !== undefined : false);
  const hasY =
    finite(props.y) !== undefined ||
    "y" in bindings ||
    (nested ? finite(nested.y) !== undefined : false);
  return hasX && hasY;
}

function Repeat({ node, store }: TreeProps): ReactNode {
  useSignals();
  const scope = usePathScope();
  checkNodeProps(node);

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
