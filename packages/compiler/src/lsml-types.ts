// LSML 1.0 / 1.1 input types — what authors write.
// Reference: lumencast-protocol/spec/LSML-1.md
//
// 1.1 additions (additive over 1.0) :
//   - `instance` primitive (§4.9)
//   - Universal props (`visible` / `sizing` / `opacity` / `rotation`)
//     on every primitive (§5.4)
//   - `bindUniversal` field on every primitive
//   - Multi-fill `fills[]` on `shape` (§4.6 + §4.12)
//   - Stacked `backgrounds[]` on `frame` (§4.3)
//   - Bundle-level `$schema`, `profiles[]` (§17.3)

export type LSMLPrimitiveKind =
  | "stack"
  | "grid"
  | "frame"
  | "text"
  | "image"
  | "shape"
  | "media"
  | "repeat"
  | "instance";

export interface LSMLBindObject {
  /** Most primitives bind a `value` to a leaf path. */
  value?: string;
  /** image / media bind a `src`. */
  src?: string;
  /** repeat binds `items`. */
  items?: string;
}

/** 1.1+ — a gradient stop (LSML §4.12). */
export interface LSMLFillStop {
  offset: number;
  color: string;
  opacity?: number;
}

/** 1.1+ — Fill union used by `shape.fills[]` and `frame.backgrounds[]`
 *  (LSML §4.12). Discriminated on `kind`. */
export type LSMLFill =
  | { kind: "solid"; color: string; opacity?: number }
  | { kind: "linear-gradient"; angle_deg?: number; stops: LSMLFillStop[]; opacity?: number }
  | {
      kind: "radial-gradient";
      center?: { x: number; y: number };
      radius?: number;
      stops: LSMLFillStop[];
      opacity?: number;
    };

/** 1.1+ — one stacked stroke layer (LSML §4.6). */
export interface LSMLStroke {
  color: string;
  width: number;
}

/** 1.1+ — one subpath of a `geometry: "path"` shape (LSML §4.6). */
export interface LSMLPath {
  /** SVG path `d` attribute syntax. Validated at compile (ADR 001 RC#10). */
  data: string;
  /** Winding rule for this subpath. Default `"NONZERO"`. */
  windingRule?: "NONZERO" | "EVENODD";
}

/** 1.1+ — one waypoint of a keyframe sequence (LSML §6.6). Same shapes
 *  as `animate.transform` / `animate.opacity` / `animate.filter`. */
export interface LSMLKeyframeStep {
  /** Timeline position 0..1, normalised over `duration_ms`. */
  at: number;
  transform?: {
    translate?: [number, number];
    scale?: number | [number, number];
    rotate?: number;
  };
  opacity?: number;
  filter?: {
    blur?: number;
    brightness?: number;
  };
}

/** 1.1+ — multi-step keyframe sequence (LSML §6.6). */
export interface LSMLKeyframes {
  /** LeafPath whose value-change replays the sequence. Omitted = mount-only. */
  key?: string;
  steps: LSMLKeyframeStep[];
  duration_ms: number;
  easing?: "linear" | "ease-in" | "ease-out" | "ease-in-out";
}

/** The visual state an `animate` directive can target (and, via `from`,
 *  start from). `from` carries the same fields ; it is the mount-time
 *  initial state that makes an authored `animate` play *on mount* without
 *  any operator delta or KeyframePlayer. */
export interface LSMLAnimateState {
  transform?: {
    translate?: [number, number];
    scale?: number | [number, number];
    rotate?: number;
  };
  opacity?: number;
  filter?: {
    blur?: number;
    brightness?: number;
  };
}

export interface LSMLAnimateDirective extends LSMLAnimateState {
  transition?: {
    duration?: number;
    easing?: "linear" | "ease-in" | "ease-out" | "ease-in-out" | "spring";
    stiffness?: number;
    damping?: number;
    /** 1.1 §6.2 — spring mass. Typed for forward-compat ; not lowered
     *  yet (ADR 001 phase B) — the compiler emits an `onWarn` diagnostic
     *  instead of dropping it silently. */
    mass?: number;
  };
  /** LSML 1.1 — mount-time initial state. When present, the element
   *  mounts with these values and animates to its declared target
   *  (`opacity` / `transform` on the directive) on mount. When absent,
   *  behaviour is unchanged (no mount-play ; rétro-compatible). */
  from?: LSMLAnimateState;
}

export interface LSMLBaseNode {
  kind: LSMLPrimitiveKind;
  id?: string;
  bind?: LSMLBindObject;
  bindStyle?: Record<string, string>;
  /** 1.1+ — bind universal props to leaf paths. */
  bindUniversal?: Record<string, string>;
  animate?: LSMLAnimateDirective;
  /** 1.1+ §6.3 — animation targets bound to leaf paths. Typed for
   *  forward-compat ; not lowered yet (ADR 001 phase B) — the compiler
   *  emits an `onWarn` diagnostic instead of dropping it silently. */
  bindAnimate?: Record<string, string>;
  /** 1.1+ §6.6 — keyframe sequence, played on mount or `key` change. */
  keyframes?: LSMLKeyframes;
  children?: LSMLNode[];
  /** 1.1+ — visibility flag (LSML §5.4). Defaults to true. */
  visible?: boolean;
  /** 1.1+ — opacity 0..1 (LSML §5.4). Defaults to 1. */
  opacity?: number;
  /** 1.1+ — rotation in degrees (LSML §5.4). Defaults to 0. */
  rotation?: number;
  /** 1.1+ — per-axis sizing mode (LSML §5.4). */
  sizing?: { x?: "fixed" | "hug" | "fill"; y?: "fixed" | "hug" | "fill" };
  /** 1.1+ — universal position relative to parent (LSML §5.4). */
  position?: { x: number; y: number };
  /** Open-ended authoring metadata (LSML §17.4). Runtime ignores. */
  metadata?: Record<string, unknown>;
}

export interface LSMLStack extends LSMLBaseNode {
  kind: "stack";
  direction?: "horizontal" | "vertical";
  gap?: number;
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "space-between" | "space-around";
  padding?: number | [number, number, number, number];
  rtl?: "auto" | boolean;
}

export interface LSMLGrid extends LSMLBaseNode {
  kind: "grid";
  columns: number | unknown[];
  rows?: number | unknown[];
  gap?: number | [number, number];
  padding?: number | unknown[];
}

export interface LSMLFrame extends LSMLBaseNode {
  kind: "frame";
  size?: { w: number; h: number };
  position?: { x: number; y: number };
  /** Single solid background. Mutually exclusive with `backgrounds`. */
  background?: string;
  /** 1.1+ — stacked backgrounds, top-to-bottom (LSML §4.3 + §4.12).
   *  Mutually exclusive with `background`. */
  backgrounds?: LSMLFill[];
  /** 1.1+ — clip children to the frame's `size` (LSML §4.3). Spec
   *  default is `true` ; the default is runtime-side, the compiler only
   *  forwards an explicit value. */
  clipsContent?: boolean;
}

export interface LSMLText extends LSMLBaseNode {
  kind: "text";
  style?: {
    fontSize?: number | string;
    fontFamily?: string;
    fontWeight?: number;
    color?: string;
    textAlign?: "start" | "center" | "end" | "left" | "right";
    lineHeight?: number;
    letterSpacing?: number;
    textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
    textDecoration?: "none" | "underline" | "line-through";
    fontStyle?: "normal" | "italic" | "oblique";
  };
  format?: { kind: string; [extra: string]: unknown };
  maxLines?: number;
}

export interface LSMLImage extends LSMLBaseNode {
  kind: "image";
  alt: string;
  size: { w: number; h: number };
  fit?: "contain" | "cover" | "fill" | "none";
}

export interface LSMLShape extends LSMLBaseNode {
  kind: "shape";
  geometry: "rect" | "circle" | "path";
  size?: { w: number; h: number };
  /** Single-path shorthand (LSML §4.6). Mutually exclusive with `paths`. */
  pathData?: string;
  /** 1.1+ — multi-subpath geometry with per-subpath winding rules
   *  (LSML §4.6). Mutually exclusive with `pathData`. */
  paths?: LSMLPath[];
  /** Single solid fill. Mutually exclusive with `fills`. */
  fill?: string;
  /** 1.1+ — stacked fills, top-to-bottom (LSML §4.6 + §4.12).
   *  Mutually exclusive with `fill`. */
  fills?: LSMLFill[];
  /** Single stroke. Mutually exclusive with `strokes`. */
  stroke?: { color: string; width: number };
  /** 1.1+ — stacked strokes, top-to-bottom (LSML §4.6). */
  strokes?: LSMLStroke[];
  cornerRadius?: number;
  ariaLabel?: string;
}

export interface LSMLMedia extends LSMLBaseNode {
  kind: "media";
  kind_hint: "video" | "audio";
  controls?: boolean;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  size?: { w: number; h: number };
}

export interface LSMLRepeat extends LSMLBaseNode {
  kind: "repeat";
  scope: string;
  key?: string;
  template: LSMLNode;
  limit?: number;
  /** 1.1+ §6.7 — per-iteration animation stagger in milliseconds.
   *  Iteration N's animations start `N * stagger_ms` after iteration 0. */
  stagger_ms?: number;
}

/** 1.1+ — `instance` primitive (LSML §4.9). Mounts a sub-scene by id with
 *  bound parameters. */
export interface LSMLInstance extends LSMLBaseNode {
  kind: "instance";
  scene_id: string;
  scene_version: string;
  size?: { w: number; h: number };
  fit?: "contain" | "cover" | "stretch";
  params?: Record<string, unknown>;
  bindParams?: Record<string, string>;
}

export type LSMLNode =
  | LSMLStack
  | LSMLGrid
  | LSMLFrame
  | LSMLText
  | LSMLImage
  | LSMLShape
  | LSMLMedia
  | LSMLRepeat
  | LSMLInstance;

export interface LSMLOperatorInput {
  path: string;
  label: string;
  type: string;
  constraints?: Record<string, unknown>;
  writable_by: string[];
  group?: string;
  [extra: string]: unknown;
}

export interface LSMLBundle {
  lsml: "1.0" | "1.1";
  /** 1.1+ — informational schema URL for editor autocomplete (LSML §18.4). */
  $schema?: string;
  scene_id: string;
  scene_version: string;
  /** 1.1+ — capability profiles the bundle requires (LSML §17.3). */
  profiles?: string[];
  layout: LSMLNode;
  operator_inputs?: LSMLOperatorInput[];
  external_adapters?: unknown[];
  defaults?: Record<string, unknown>;
  assets?: { allowedHosts?: string[]; fonts?: unknown[]; preload?: string[] };
  i18n?: { default_locale?: string; locales?: Record<string, Record<string, string>> };
  metadata?: Record<string, unknown>;
}
