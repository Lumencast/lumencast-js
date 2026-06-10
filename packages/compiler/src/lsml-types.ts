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
  background?: string;
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
  pathData?: string;
  fill?: string;
  stroke?: { color: string; width: number };
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
