// LSML 1.0 → flat RenderBundle compiler.
//
// LSML lets authors write idiomatic primitives with inline `bind: { value: "path" }`,
// CSS-style `style.fontSize`, `repeat.template`, `animate` directives. The runtime
// expects a flat shape: per-node `bindings` map, primitive-specific prop names
// (Solar lineage: `text.size`, `text.colour`), and `repeat` whose template is its
// only child.
//
// This compiler bridges the two formats. It does NOT execute the bundle — it
// produces a JSON the runtime then renders.

import type { RenderBundle, RenderNode } from "@lumencast/runtime";
import type {
  LSMLAnimateDirective,
  LSMLBundle,
  LSMLNode,
  LSMLRepeat,
  LSMLText,
} from "./lsml-types.js";

export interface CompileOptions {
  /** When true, throws on any unrecognized LSML extension. Default false (warn-only). */
  strict?: boolean;
  /** Optional warn collector — receives each warning string. */
  onWarn?: (message: string) => void;
}

export function compileBundle(lsml: LSMLBundle, options: CompileOptions = {}): RenderBundle {
  if (lsml.lsml !== "1.0") {
    throw new Error(`compiler: only LSML 1.0 is supported, got ${lsml.lsml}`);
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
      if (node.pathData !== undefined) props["pathData"] = node.pathData;
      if (node.fill !== undefined) props["fill"] = node.fill;
      if (node.stroke !== undefined) props["stroke"] = node.stroke;
      if (node.cornerRadius !== undefined) props["cornerRadius"] = node.cornerRadius;
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
      if (node.animate.transform?.scale !== undefined) transitions["scale"] = tx;
      if (node.animate.transform?.rotate !== undefined) transitions["rotate"] = tx;
      if (node.animate.transform?.translate !== undefined) {
        transitions["x"] = tx;
        transitions["y"] = tx;
      }
      // Type assertion: RenderNode.transitions matches Transition shape; the
      // cast keeps the compiler self-contained without re-importing the runtime
      // Transition type.
      if (Object.keys(transitions).length > 0) {
        out.transitions = transitions as RenderNode["transitions"];
      }
    }
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
  return out;
}

function mapTextStyle(node: LSMLText, props: Record<string, unknown>): void {
  if (!node.style) return;
  const s = node.style;
  // Solar's Text primitive consumes size/weight/colour (UK), not CSS-style names.
  if (s.fontSize !== undefined) props["size"] = s.fontSize;
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
