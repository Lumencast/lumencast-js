// LSML 1.0 / 1.1 → flat RenderBundle compiler.
//
// LSML lets authors write idiomatic primitives with inline `bind: { value: "path" }`,
// CSS-style `style.fontSize`, `repeat.template`, `animate` directives. The runtime
// expects a flat shape: per-node `bindings` map, primitive-specific prop names
// (Solar lineage: `text.size`, `text.colour`), and `repeat` whose template is its
// only child.
//
// This compiler bridges the two formats. It does NOT execute the bundle — it
// produces a JSON the runtime then renders.
//
// Version support :
//   - 1.0 (LSML-1.md) : the original 9-primitive catalog.
//   - 1.1 (LSML-1.md §17 / §5.4 / §4.9) : additive over 1.0 — `instance`
//     primitive, universal props (`visible` / `sizing` / `opacity` /
//     `rotation`) on every primitive, `bindUniversal` field, multi-fill
//     `fills[]` on shapes, stacked `backgrounds[]` on frames, profile
//     declarations, `$schema` field.
//
// Unsupported 1.1 features compile to best-effort output (the renderer
// surfaces `BUNDLE_INCOMPATIBLE` per LSML §15.1 if it can't honour them).
// Bundles tagged 2.x are rejected — major bumps require explicit support.

import type { RenderBundle, RenderNode } from "@lumencast/runtime";
import type {
  LSMLAnimateDirective,
  LSMLAnimateState,
  LSMLBundle,
  LSMLKeyframes,
  LSMLNode,
  LSMLPath,
  LSMLRepeat,
  LSMLText,
} from "./lsml-types.js";

export interface CompileOptions {
  /** When true, throws on any unrecognized LSML extension. Default false (warn-only). */
  strict?: boolean;
  /** Optional warn collector — receives each warning string. */
  onWarn?: (message: string) => void;
}

const SUPPORTED_VERSIONS = new Set(["1.0", "1.1"] as const);

// --- hard caps (ADR 001 §5.1 R8 + §6 RC#10, threat model Bastion) ------
//
// Filter clamps — an unbounded `filter` is a compositing DoS in CEF.
/** Max CSS `blur()` radius emitted by the compiler, in px. */
export const MAX_FILTER_BLUR_PX = 100;
/** Max CSS `brightness()` factor emitted by the compiler (spec §6.1
 *  explicitly blesses clamping to 4). */
export const MAX_FILTER_BRIGHTNESS = 4;
// Path caps — `d` strings are untrusted author input rendered into SVG.
/** Max size of a single subpath `d` string (8 KiB, RC#10). */
export const MAX_PATH_SUBPATH_BYTES = 8192;
/** Max number of subpaths on a single shape (RC#10). */
export const MAX_PATH_SUBPATHS = 64;
/** Max number of path commands per subpath (RC#10). Kept below the
 *  densest possible command packing within the byte cap (single-letter
 *  `Z` spam = 1 command/byte) so the cap is actually reachable. */
export const MAX_PATH_COMMANDS = 4000;

/** Runtime keyframes shape (`@lumencast/runtime` `Keyframes`), referenced
 *  through `RenderNode` so the compiler stays a type-only consumer. */
type RuntimeKeyframes = NonNullable<RenderNode["keyframes"]>;
type RuntimeKeyframeStep = RuntimeKeyframes["steps"][number];

/** Emit an anti-silent-drop diagnostic (ADR 001 §3.4). Per Bastion R9 the
 *  message carries `node.id` + field + reason and NEVER the offending
 *  value (leaf/prop values can carry sensitive on-air content). */
function warn(
  opts: CompileOptions,
  nodeId: string | undefined,
  field: string,
  reason: string,
): void {
  const message = `compiler: node "${nodeId ?? "<anon>"}": field "${field}" ${reason}`;
  if (opts.strict) throw new Error(message);
  opts.onWarn?.(message);
}

/** Hard compile error — invalid value. Per R9 the message names the node
 *  and field but never echoes the value itself. */
function invalid(nodeId: string | undefined, field: string, reason: string): Error {
  return new Error(`compiler: node "${nodeId ?? "<anon>"}": field "${field}" ${reason}`);
}

export function compileBundle(lsml: LSMLBundle, options: CompileOptions = {}): RenderBundle {
  if (!SUPPORTED_VERSIONS.has(lsml.lsml as "1.0" | "1.1")) {
    throw new Error(
      `compiler: LSML version "${lsml.lsml}" is not supported (supported: ${[...SUPPORTED_VERSIONS].join(", ")})`,
    );
  }
  return {
    scene_version: lsml.scene_version,
    root: compileNode(lsml.layout, options),
    ...(lsml.operator_inputs
      ? {
          operator_inputs: lsml.operator_inputs.map((oi) => ({
            path: oi.path,
            label: oi.label,
            type: oi.type as never,
            writable_by: oi.writable_by,
            ...(oi.group !== undefined ? { group: oi.group } : {}),
            ...(oi.constraints ?? {}),
          })),
        }
      : {}),
    ...(lsml.external_adapters
      ? {
          external_adapters: lsml.external_adapters as RenderBundle["external_adapters"],
        }
      : {}),
  };
}

function compileNode(node: LSMLNode, opts: CompileOptions): RenderNode {
  if (node.kind === "repeat") {
    return compileRepeat(node, opts);
  }

  const props: Record<string, unknown> = {};
  const bindings: Record<string, string> = {};

  // Common: bind.value/src → bindings
  if (node.bind?.value !== undefined) bindings["value"] = node.bind.value;
  if (node.bind?.src !== undefined) bindings["src"] = node.bind.src;
  if (node.bindStyle) {
    for (const [k, v] of Object.entries(node.bindStyle)) bindings[k] = v;
  }

  switch (node.kind) {
    case "stack":
      if (node.direction !== undefined) props["direction"] = node.direction;
      if (node.gap !== undefined) props["gap"] = node.gap;
      if (node.align !== undefined) props["align"] = mapAlign(node.align);
      if (node.justify !== undefined) props["justify"] = mapJustify(node.justify);
      if (node.padding !== undefined) props["padding"] = node.padding;
      if (node.rtl !== undefined) props["rtl"] = node.rtl;
      break;

    case "grid":
      if (node.columns !== undefined) props["columns"] = node.columns;
      if (node.rows !== undefined) props["rows"] = node.rows;
      if (node.gap !== undefined) props["gap"] = node.gap;
      if (node.padding !== undefined) props["padding"] = node.padding;
      break;

    case "frame":
      if (node.size !== undefined) {
        props["width"] = node.size.w;
        props["height"] = node.size.h;
      }
      if (node.position !== undefined) {
        props["x"] = node.position.x;
        props["y"] = node.position.y;
      }
      if (node.background !== undefined) props["background"] = node.background;
      // 1.1 §4.3 + §4.12 — stacked backgrounds (frame.tsx reads
      // `resolved.backgrounds`; array form wins over legacy `background`).
      if (node.backgrounds !== undefined) props["backgrounds"] = node.backgrounds;
      // 1.1 §4.3 — clip children to the frame bounds. The spec default
      // (`true`) is applied runtime-side ; only explicit values forward.
      if (node.clipsContent !== undefined) props["clipsContent"] = node.clipsContent;
      break;

    case "text":
      mapTextStyle(node, props);
      if (node.format !== undefined) props["format"] = node.format;
      if (node.maxLines !== undefined) props["maxLines"] = node.maxLines;
      break;

    case "image":
      props["alt"] = node.alt;
      props["width"] = node.size.w;
      props["height"] = node.size.h;
      if (node.fit !== undefined) props["fit"] = node.fit;
      break;

    case "shape":
      props["geometry"] = node.geometry;
      if (node.size !== undefined) {
        props["width"] = node.size.w;
        props["height"] = node.size.h;
      }
      // Path geometry — every `d` string is untrusted author input that
      // ends up in an SVG attribute. Validate at compile per RC#10 (the
      // runtime re-validates live deltas in its own gate — issue #30).
      if (node.pathData !== undefined) {
        validatePathData(node.pathData, node.id, "pathData");
        props["pathData"] = node.pathData;
      }
      if (node.paths !== undefined) {
        props["paths"] = lowerPaths(node.paths, node.id);
        if (node.pathData !== undefined) {
          // §4.6 declares the two forms mutually exclusive ; we keep
          // both forwarded (runtime prefers `paths`) but surface it.
          warn(opts, node.id, "pathData", "is mutually exclusive with paths[] (LSML §4.6)");
        }
      }
      if (node.fill !== undefined) props["fill"] = node.fill;
      // 1.1 §4.6 + §4.12 — stacked fills (shape.tsx reads `resolved.fills`).
      if (node.fills !== undefined) props["fills"] = node.fills;
      // Single stroke lowers to the flat props shape.tsx consumes
      // (`stroke` = colour string, `stroke_width` = number). The previous
      // object forward was silently unrenderable.
      if (node.stroke !== undefined) {
        props["stroke"] = node.stroke.color;
        props["stroke_width"] = node.stroke.width;
      }
      // 1.1 §4.6 — stacked strokes (shape.tsx reads `resolved.strokes`).
      if (node.strokes !== undefined) props["strokes"] = node.strokes;
      // Canonical RenderNode name is `radius` (what shape.tsx reads) ;
      // the previous `cornerRadius` forward was silently dropped.
      if (node.cornerRadius !== undefined) props["radius"] = node.cornerRadius;
      if (node.ariaLabel !== undefined) props["ariaLabel"] = node.ariaLabel;
      break;

    case "media":
      props["kind_hint"] = node.kind_hint;
      if (node.controls !== undefined) props["controls"] = node.controls;
      if (node.autoplay !== undefined) props["autoplay"] = node.autoplay;
      if (node.muted !== undefined) props["muted"] = node.muted;
      if (node.loop !== undefined) props["loop"] = node.loop;
      if (node.size !== undefined) {
        props["width"] = node.size.w;
        props["height"] = node.size.h;
      }
      break;

    case "instance":
      // 1.1+ — sub-scene mount (LSML §4.9). The runtime resolves
      // `scene_id` + `scene_version` to a separate bundle and renders
      // it inline ; the compiler just forwards the reference.
      props["scene_id"] = node.scene_id;
      props["scene_version"] = node.scene_version;
      if (node.size !== undefined) {
        props["width"] = node.size.w;
        props["height"] = node.size.h;
      }
      if (node.fit !== undefined) props["fit"] = node.fit;
      if (node.params !== undefined) props["params"] = node.params;
      if (node.bindParams) {
        for (const [k, v] of Object.entries(node.bindParams)) {
          bindings[`params.${k}`] = v;
        }
      }
      break;
  }

  // Universal props (LSML §5.4 — 1.1+). Forwarded to the renderer when
  // present on the source node. Defaults are spec-side, not compiler-side
  // (the runtime applies them per primitive).
  if (node.visible !== undefined) props["visible"] = node.visible;
  if (node.opacity !== undefined) props["opacity"] = node.opacity;
  if (node.rotation !== undefined) props["rotation"] = node.rotation;
  if (node.sizing !== undefined) props["sizing"] = node.sizing;
  if (node.position !== undefined && props["x"] === undefined && props["y"] === undefined) {
    // Frame's case above already sets x/y from `position` ; the universal
    // §5.4 prop takes effect on every other primitive.
    props["x"] = node.position.x;
    props["y"] = node.position.y;
  }
  if (node.bindUniversal) {
    for (const [k, v] of Object.entries(node.bindUniversal)) bindings[k] = v;
  }

  const children = node.children?.map((c) => compileNode(c, opts));

  const out: RenderNode = { kind: node.kind };
  if (node.id !== undefined) out.id = node.id;
  if (Object.keys(props).length > 0) out.props = props;
  if (Object.keys(bindings).length > 0) out.bindings = bindings;
  if (children && children.length > 0) out.children = children;

  // Animate directive → transitions on the listed prop keys.
  if (node.animate) {
    const tx = compileAnimate(node.animate);
    if (tx) {
      const transitions: Record<string, ReturnType<typeof compileAnimate>> = {};
      if (node.animate.opacity !== undefined) transitions["opacity"] = tx;
      if (node.animate.transform?.scale !== undefined) {
        // Per-axis `[sx, sy]` lowers to framer's `scaleX` / `scaleY`
        // motion keys ; a scalar stays on uniform `scale`.
        if (Array.isArray(node.animate.transform.scale)) {
          transitions["scaleX"] = tx;
          transitions["scaleY"] = tx;
        } else {
          transitions["scale"] = tx;
        }
      }
      if (node.animate.transform?.rotate !== undefined) transitions["rotate"] = tx;
      if (node.animate.transform?.translate !== undefined) {
        transitions["x"] = tx;
        transitions["y"] = tx;
      }
      // §6.1 — `filter` is animatable ; previously dropped in silence.
      if (node.animate.filter !== undefined) transitions["filter"] = tx;
      // Type assertion: RenderNode.transitions matches Transition shape; the
      // cast keeps the compiler self-contained without re-importing the runtime
      // Transition type.
      if (Object.keys(transitions).length > 0) {
        out.transitions = transitions as RenderNode["transitions"];
      }
    }

    // §6.2 `transition.mass` is spec'd but not lowered yet (ADR 001
    // phase B adds it to SpringTransition). Anti-silent-drop : diagnose.
    if (node.animate.transition?.mass !== undefined) {
      warn(opts, node.id, "animate.transition.mass", "is not lowered yet (ADR 001 phase B)");
    }

    // LSML 1.1 §6 `animate.from` → flat framer `initial` map. Lowered
    // independently of `transition` : an author may declare a `from`
    // without a `transition` (mount-play with the runtime's default
    // timing). When no `from` is present, `animate_initial` is omitted
    // and the prior no-mount-play behaviour is preserved (rétro-compat).
    if (node.animate.from) {
      const initial = lowerAnimateState(node.animate.from, node.id, opts);
      if (Object.keys(initial).length > 0) {
        out.animate_initial = initial;
      }
    }
  }

  // §6.3 `bindAnimate` is spec'd but not lowered yet (ADR 001 phase B,
  // issue #33). Anti-silent-drop : diagnose instead of dropping.
  if (node.bindAnimate !== undefined) {
    warn(opts, node.id, "bindAnimate", "is not lowered yet (ADR 001 phase B)");
  }

  // LSML 1.1 §6.6 — keyframe sequence, lowered to the runtime
  // `Keyframes` shape consumed by KeyframePlayer.
  if (node.keyframes !== undefined) {
    out.keyframes = lowerKeyframes(node.keyframes, node.id, opts);
  }

  return out;
}

// --- path validation (ADR 001 §6 RC#10 — compile-side gate) -----------
//
// SVG `d` strings are untrusted author input rendered into a DOM
// attribute. The grammar is ALLOWLISTED : path command letters
// `MmLlHhVvCcSsQqTtAaZz` plus number/separator characters only. This
// rejects `url(`, `data:`, `<` and `&` by construction (none of their
// characters are in the allowlist). Implemented as a single-pass manual
// scanner — linear time, no regex, no backtracking (anti-ReDoS, RC#12).
//
// Known limitation (by design) : the scanner is CHAR-LEVEL, not a number
// grammar. Malformed numerics built from allowlisted characters (`1.2.3`,
// `+-+5`, overflow exponents like `1e9999`) pass validation. This is
// accepted : a syntactically invalid `d` is simply ignored by the
// browser's SVG path parser (the path does not render), so there is no
// injection or DoS vector — only the author's own shape failing to draw.
// Upgrading to a full number grammar would add parser complexity for no
// security gain.
const PATH_COMMANDS = new Set("MmLlHhVvCcSsQqTtAaZz");

function isPathNumberChar(ch: string): boolean {
  return (ch >= "0" && ch <= "9") || ch === "." || ch === "+" || ch === "-" || ch === ",";
}

function isPathWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/** Validate one subpath `d` string. Throws on any violation (size cap,
 *  command cap, character outside the allowlist). Error messages name
 *  the node + field but never echo the string (R9). */
export function validatePathData(d: string, nodeId: string | undefined, field: string): void {
  if (typeof d !== "string" || d.length === 0) {
    throw invalid(nodeId, field, "must be a non-empty SVG path string");
  }
  // Allowlisted grammar is ASCII-only, so UTF-16 length === byte length
  // for any string that passes the scan ; checking the cap first keeps
  // the scan itself bounded.
  if (d.length > MAX_PATH_SUBPATH_BYTES) {
    throw invalid(nodeId, field, `exceeds the ${MAX_PATH_SUBPATH_BYTES}-byte subpath cap (RC#10)`);
  }
  let commands = 0;
  for (let i = 0; i < d.length; i++) {
    const ch = d[i] as string;
    if (PATH_COMMANDS.has(ch)) {
      commands++;
      if (commands > MAX_PATH_COMMANDS) {
        throw invalid(
          nodeId,
          field,
          `exceeds the ${MAX_PATH_COMMANDS}-command subpath cap (RC#10)`,
        );
      }
      continue;
    }
    if (isPathNumberChar(ch) || isPathWhitespace(ch)) continue;
    // Exponent marker — only valid immediately after a digit or dot
    // (e.g. `1e3`, `1.5E-2`). A bare `e`/`E` is rejected.
    if ((ch === "e" || ch === "E") && i > 0) {
      const prev = d[i - 1] as string;
      if ((prev >= "0" && prev <= "9") || prev === ".") continue;
    }
    throw invalid(nodeId, field, `contains a character outside the SVG path allowlist (RC#10)`);
  }
  if (commands === 0) {
    throw invalid(nodeId, field, "contains no SVG path command");
  }
}

/** Validate + forward `paths[]` (LSML §4.6). Caps the subpath count and
 *  validates every `data` string. */
function lowerPaths(
  paths: LSMLPath[],
  nodeId: string | undefined,
): { data: string; windingRule?: "NONZERO" | "EVENODD" }[] {
  if (paths.length === 0) {
    throw invalid(nodeId, "paths", "must contain at least one subpath");
  }
  if (paths.length > MAX_PATH_SUBPATHS) {
    throw invalid(nodeId, "paths", `exceeds the ${MAX_PATH_SUBPATHS}-subpath cap (RC#10)`);
  }
  return paths.map((p, i) => {
    validatePathData(p.data, nodeId, `paths[${i}].data`);
    return {
      data: p.data,
      ...(p.windingRule !== undefined ? { windingRule: p.windingRule } : {}),
    };
  });
}

// --- filter lowering (ADR 001 §5.1 R8 — hard clamps, non-optional) -----

/** Lower an LSML `filter` state (`{ blur?, brightness? }`) to the CSS
 *  filter string framer-motion animates. Values are HARD-clamped at
 *  lowering : negative / non-finite values are rejected (compile error),
 *  `blur` caps at MAX_FILTER_BLUR_PX, `brightness` caps at
 *  MAX_FILTER_BRIGHTNESS. Both functions are always emitted so framer
 *  can interpolate between structurally-identical filter lists. */
function lowerFilter(
  f: NonNullable<LSMLAnimateState["filter"]>,
  nodeId: string | undefined,
  field: string,
  opts: CompileOptions,
): string {
  let blur = 0;
  let brightness = 1;
  if (f.blur !== undefined) {
    // `-0 < 0` is false in IEEE-754 — Object.is closes the negative-zero hole.
    if (
      typeof f.blur !== "number" ||
      !Number.isFinite(f.blur) ||
      f.blur < 0 ||
      Object.is(f.blur, -0)
    ) {
      throw invalid(nodeId, `${field}.blur`, "must be a finite number >= 0 (R8)");
    }
    blur = f.blur;
    if (blur > MAX_FILTER_BLUR_PX) {
      blur = MAX_FILTER_BLUR_PX;
      warn(opts, nodeId, `${field}.blur`, `clamped to the ${MAX_FILTER_BLUR_PX}px cap (R8)`);
    }
  }
  if (f.brightness !== undefined) {
    // Same -0 gate as blur : `brightness(-0)` stringifies to `brightness(0)`,
    // a fully black element slipping past the negative-value rejection (R8).
    if (
      typeof f.brightness !== "number" ||
      !Number.isFinite(f.brightness) ||
      f.brightness < 0 ||
      Object.is(f.brightness, -0)
    ) {
      throw invalid(nodeId, `${field}.brightness`, "must be a finite number >= 0 (R8)");
    }
    brightness = f.brightness;
    if (brightness > MAX_FILTER_BRIGHTNESS) {
      brightness = MAX_FILTER_BRIGHTNESS;
      warn(opts, nodeId, `${field}.brightness`, `clamped to the ${MAX_FILTER_BRIGHTNESS} cap (R8)`);
    }
  }
  return `blur(${blur}px) brightness(${brightness})`;
}

// --- keyframes lowering (LSML §6.6 → runtime Keyframes shape) ----------

/** Lower a §6.6 keyframe sequence into the shape KeyframePlayer /
 *  compileForFramer consume : `transform.translate: [x, y]` →
 *  `translateX` / `translateY`, `filter: { blur, brightness }` → clamped
 *  CSS string. Per-axis step scale degrades to `sx` with a diagnostic
 *  (the runtime keyframe channel is uniform-scale ; per-axis keyframe
 *  scale lands with ADR 001 phase B/C). */
function lowerKeyframes(
  kf: LSMLKeyframes,
  nodeId: string | undefined,
  opts: CompileOptions,
): RuntimeKeyframes {
  const steps: RuntimeKeyframeStep[] = kf.steps.map((s, i) => {
    const step: RuntimeKeyframeStep = { at: s.at };
    if (s.opacity !== undefined) step.opacity = s.opacity;
    if (s.filter !== undefined) {
      step.filter = lowerFilter(s.filter, nodeId, `keyframes.steps[${i}].filter`, opts);
    }
    const t = s.transform;
    if (t) {
      const transform: NonNullable<RuntimeKeyframeStep["transform"]> = {};
      if (t.scale !== undefined) {
        if (Array.isArray(t.scale)) {
          transform.scale = t.scale[0];
          warn(
            opts,
            nodeId,
            `keyframes.steps[${i}].transform.scale`,
            "per-axis scale is not supported in keyframes yet ; lowered to the x-axis value",
          );
        } else {
          transform.scale = t.scale;
        }
      }
      if (t.rotate !== undefined) transform.rotate = t.rotate;
      if (t.translate !== undefined) {
        transform.translateX = t.translate[0];
        transform.translateY = t.translate[1];
      }
      if (Object.keys(transform).length > 0) step.transform = transform;
    }
    return step;
  });
  return {
    ...(kf.key !== undefined ? { key: kf.key } : {}),
    steps,
    duration_ms: kf.duration_ms,
    ...(kf.easing !== undefined ? { easing: kf.easing } : {}),
  };
}

/** Lower an `animate.from` (or any LSML animate state) into the flat
 *  framer-motion key space the runtime primitives consume: `opacity`,
 *  `scale` (or `scaleX`/`scaleY` for a per-axis `[sx, sy]` pair),
 *  `rotate`, `x`, `y`, `filter` (clamped CSS string, R8).
 *  `translate: [x, y]` → `x` / `y`. */
function lowerAnimateState(
  s: LSMLAnimateState,
  nodeId: string | undefined,
  opts: CompileOptions,
): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  if (typeof s.opacity === "number") out["opacity"] = s.opacity;
  const t = s.transform;
  if (t) {
    if (t.scale !== undefined) {
      if (Array.isArray(t.scale)) {
        out["scaleX"] = t.scale[0];
        out["scaleY"] = t.scale[1];
      } else {
        out["scale"] = t.scale;
      }
    }
    if (typeof t.rotate === "number") out["rotate"] = t.rotate;
    if (t.translate !== undefined) {
      out["x"] = t.translate[0];
      out["y"] = t.translate[1];
    }
  }
  if (s.filter !== undefined) {
    out["filter"] = lowerFilter(s.filter, nodeId, "animate.from.filter", opts);
  }
  return out;
}

function compileRepeat(node: LSMLRepeat, opts: CompileOptions): RenderNode {
  if (!node.bind?.items) {
    throw new Error(`compiler: repeat node "${node.id ?? "<anon>"}" missing bind.items`);
  }
  const compiledTemplate = compileNode(node.template, opts);
  const out: RenderNode = {
    kind: "repeat",
    bindings: { items: node.bind.items },
    children: [compiledTemplate],
  };
  if (node.id !== undefined) out.id = node.id;
  // LSML 1.1 §6.7 — per-iteration stagger. Negative values are invalid ;
  // the runtime caps the effective delay (STAGGER_CAP_MS) at render.
  if (node.stagger_ms !== undefined) {
    if (
      typeof node.stagger_ms !== "number" ||
      !Number.isFinite(node.stagger_ms) ||
      node.stagger_ms < 0
    ) {
      throw invalid(node.id, "stagger_ms", "must be a finite number >= 0");
    }
    out.stagger_ms = node.stagger_ms;
  }
  return out;
}

function mapTextStyle(node: LSMLText, props: Record<string, unknown>): void {
  if (!node.style) return;
  const s = node.style;
  // Solar's Text primitive consumes size/weight/colour (UK), not CSS-style names.
  if (s.fontSize !== undefined) props["size"] = s.fontSize;
  if (s.fontFamily !== undefined) props["font"] = s.fontFamily;
  if (s.fontWeight !== undefined) props["weight"] = s.fontWeight;
  if (s.color !== undefined) props["colour"] = s.color;
  if (s.textAlign !== undefined) props["align"] = mapTextAlign(s.textAlign);
  if (s.lineHeight !== undefined) props["lineHeight"] = s.lineHeight;
}

function mapAlign(a: NonNullable<Extract<LSMLNode, { kind: "stack" }>["align"]>): string {
  // LSML uses CSS-grid vocabulary; Solar's Stack consumes flexbox vocabulary.
  switch (a) {
    case "start":
      return "flex-start";
    case "center":
      return "center";
    case "end":
      return "flex-end";
    case "stretch":
      return "stretch";
  }
}

function mapJustify(j: NonNullable<Extract<LSMLNode, { kind: "stack" }>["justify"]>): string {
  switch (j) {
    case "start":
      return "flex-start";
    case "center":
      return "center";
    case "end":
      return "flex-end";
    case "space-between":
      return "space-between";
    case "space-around":
      return "space-around";
  }
}

function mapTextAlign(a: NonNullable<NonNullable<LSMLText["style"]>["textAlign"]>): string {
  switch (a) {
    case "start":
      return "left";
    case "end":
      return "right";
    default:
      return a;
  }
}

function compileAnimate(a: LSMLAnimateDirective):
  | {
      kind: "tween";
      duration_ms: number;
      ease?: "linear" | "cubic-in" | "cubic-out" | "cubic-in-out";
    }
  | { kind: "spring"; stiffness?: number; damping?: number }
  | undefined {
  const t = a.transition;
  if (!t) return undefined;
  if (t.easing === "spring") {
    const out: { kind: "spring"; stiffness?: number; damping?: number } = { kind: "spring" };
    if (t.stiffness !== undefined) out.stiffness = t.stiffness;
    if (t.damping !== undefined) out.damping = t.damping;
    return out;
  }
  return {
    kind: "tween",
    duration_ms: t.duration ?? 200,
    ease: mapEase(t.easing),
  };
}

function mapEase(
  e: "linear" | "ease-in" | "ease-out" | "ease-in-out" | "spring" | undefined,
): "linear" | "cubic-in" | "cubic-out" | "cubic-in-out" | undefined {
  switch (e) {
    case "linear":
      return "linear";
    case "ease-in":
      return "cubic-in";
    case "ease-out":
      return "cubic-out";
    case "ease-in-out":
      return "cubic-in-out";
    default:
      return undefined;
  }
}
