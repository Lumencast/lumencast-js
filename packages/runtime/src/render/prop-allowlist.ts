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
 *  (`UniversalWrapper`, LSML 1.1 §5.4) on every primitive. */
const UNIVERSAL_PROPS = ["visible", "opacity", "universal_opacity", "rotation", "sizing"] as const;

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
  media: allow(["src", "loop", "mute", "autoplay", "fit"]),
  instance: allow(["scene_id", "scene_version", "size", "position"]),
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
