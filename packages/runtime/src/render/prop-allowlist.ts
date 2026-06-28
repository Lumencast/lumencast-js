// Per-primitive prop allowlists (ADR 001 §3.4 D4, issue #34).
//
// Each primitive declares the exact set of resolved-prop keys it
// consumes at render time. Any prop reaching the renderer outside the
// allowlist — whether from a compiled bundle, a hand-rolled RenderNode
// or a binding key — produces a structured diagnostic (never a silent
// drop). Values are NEVER inspected nor reported (R9) : the check is
// purely key-based.
//
// Key-based is sufficient for live deltas too : an LSDP delta can only
// change the VALUE behind an already-declared binding key
// (`resolveProps`, tree.tsx) — it can never introduce a new prop key.
// The per-node key set is therefore static, and the check runs once per
// RenderNode object (WeakSet dedup) instead of once per render.
//
// These sets mirror what each primitive's component ACTUALLY reads
// today. Spec'd fields the renderer does not consume yet (e.g. `text`
// `format`, `stack` `padding`) are deliberately NOT listed : per the
// anti-silent-drop policy they must warn until they are implemented.

import type { RenderKind, RenderNode } from "./bundle";
import { emitDiagnostic } from "./diagnostics";

/** Universal props consumed by the Tree renderer itself
 *  (`UniversalWrapper`, LSML 1.1 §5.4) on every primitive.
 *
 *  ADR 002 §3.1 (D1) — `x`/`y` (compiler-flattened LSML `position:{x,y}`)
 *  and `width`/`height` (flattened `size:{w,h}`) are consumed universally
 *  for absolute placement : the Tree reads them into the wrapper's
 *  `position`/`size`, so they are honoured on EVERY primitive, not
 *  silently dropped. Frame additionally reads them into its own absolute
 *  box (it lists them explicitly below too — the union is harmless). */
const UNIVERSAL_PROPS = [
  "visible",
  "opacity",
  "universal_opacity",
  "rotation",
  "sizing",
  "x",
  "y",
  "width",
  "height",
  // ADR 002 §3.2 (D2 / #D) — `blendMode` is consumed universally by the
  // wrapper (→ CSS `mix-blend-mode`) on every primitive.
  "blendMode",
  // ADR 002 §3.2 (#E) — a typed `mask` is lowered onto EVERY primitive by the
  // compiler and consumed by the Tree (built into a `<mask>` SVG element).
  "mask",
] as const;

function allow(keys: readonly string[]): ReadonlySet<string> {
  return new Set([...UNIVERSAL_PROPS, ...keys]);
}

/** Resolved-prop keys consumed per primitive (component + wrapper). */
export const PRIMITIVE_PROP_ALLOWLIST: Readonly<Record<RenderKind, ReadonlySet<string>>> = {
  stack: allow(["direction", "gap", "wrap", "crossGap", "align", "justify"]),
  grid: allow(["cols", "rows", "gap"]),
  frame: allow([
    "x",
    "y",
    "width",
    "height",
    "scale",
    "rotate",
    "background",
    "backgrounds",
    "clipsContent",
  ]),
  text: allow([
    "value",
    "size",
    "font",
    "weight",
    "colour",
    "align",
    "lineHeight",
    "letterSpacing",
    "textTransform",
    "textDecoration",
    "fontStyle",
    "maxLines",
  ]),
  image: allow(["src", "alt", "fit", "position", "width", "height"]),
  shape: allow([
    "geometry",
    "kind",
    "width",
    "height",
    "radius",
    "fill",
    "fills",
    "stroke",
    "stroke_width",
    "strokes",
    "pathData",
    "paths",
    "ariaLabel",
  ]),
  // `peerLabel` (ADR 006 #4) selects the live MediaStream mode : a node whose
  // source is a `meet.peer.peer_label` is rendered in `srcObject` from a host
  // resolver instead of `<video src>`. Listed so it is NOT flagged as a silent
  // drop by the anti-drop audit when a scene carries a live source.
  media: allow(["src", "peerLabel", "loop", "mute", "autoplay", "fit"]),
  // ADR 006 §3.3/§3.5 — the unified source kind. `peer_label` is the stream
  // reference (resolved to a MediaStream → srcObject) ; `object_fit`/`muted`
  // drive the video ; `x-zab.sourceKind` is advisory ; `metadata` carries the
  // editor round-trip (figma). Geometry is universal as flat `x/y/width/height`,
  // but an UNCOMPILED from-scene node carries the NESTED `position`/`size` shape
  // (the Tree flattens it as a fallback) — listed so neither form is flagged as
  // a silent drop by the anti-drop audit.
  "meet.peer": allow([
    "peer_label",
    "object_fit",
    "muted",
    "x-zab.sourceKind",
    "metadata",
    "position",
    "size",
  ]),
  instance: allow(["scene_id", "scene_version", "size", "position"]),
  // RFC-0001 / ADR 004 — vendor capture placeholder. `width`/`height` are the
  // flattened geometry (universal) ; the `x-zab.*` props are carried as
  // metadata (the renderer reserves the box, ignores deviceRef). Listed so
  // they are NOT flagged as silent drops by the anti-drop audit.
  "x-zab.capture": allow(["x-zab.sourceKind", "x-zab.deviceRef", "width", "height"]),
  // ADR Blue 009 §3.1 (Amendment 2) — vendor meet-peer SLOT placeholder.
  // `width`/`height` are the flattened geometry (universal) ; `x-zab.slotRef`
  // is the logical slot identity carried as metadata (the runtime resolves
  // `slotRef → peer_label` from stream-level ZabCam state). NO cam/peer
  // identity is carried. Listed so they are NOT flagged as silent drops.
  "x-zab.meet-peer": allow(["x-zab.slotRef", "width", "height"]),
  // `repeat` is dispatched specially by the tree ; its only consumed
  // binding is `items`.
  repeat: new Set(["items"]),
};

function isAllowed(kind: RenderKind, key: string): boolean {
  const allowed = PRIMITIVE_PROP_ALLOWLIST[kind];
  if (allowed === undefined) return true; // unknown kind warns separately (tree.tsx)
  if (allowed.has(key)) return true;
  // `instance` exposes bound sub-scene parameters under `params.*`
  // (LSML §4.9) — the whole namespace is part of its contract.
  if (kind === "instance" && (key === "params" || key.startsWith("params."))) return true;
  return false;
}

// One check per RenderNode object — bundles are immutable once fetched,
// and a node's key set cannot change live (see module header).
const checkedNodes = new WeakSet<RenderNode>();

/**
 * Audit a node's static props + binding keys against its primitive's
 * allowlist. Every unknown key emits ONE structured diagnostic naming
 * `node.id` + the prop (never the value, R9). Idempotent per node.
 */
export function checkNodeProps(node: RenderNode): void {
  if (checkedNodes.has(node)) return;
  checkedNodes.add(node);
  const keys = new Set<string>([
    ...Object.keys(node.props ?? {}),
    ...Object.keys(node.bindings ?? {}),
  ]);
  for (const key of keys) {
    if (!isAllowed(node.kind, key)) {
      emitDiagnostic(
        node.id,
        `${node.kind}.${key}`,
        "is not consumed by this primitive's renderer ; the prop is ignored (anti-silent-drop, ADR 001 §3.4)",
      );
    }
  }
}
