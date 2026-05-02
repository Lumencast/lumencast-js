// LSML 1.0 input types — what authors write.
// Reference: lumencast-protocol/spec/LSML-1.md

export type LSMLPrimitiveKind =
  | "stack"
  | "grid"
  | "frame"
  | "text"
  | "image"
  | "shape"
  | "media"
  | "repeat";

export interface LSMLBindObject {
  /** Most primitives bind a `value` to a leaf path. */
  value?: string;
  /** image / media bind a `src`. */
  src?: string;
  /** repeat binds `items`. */
  items?: string;
}

export interface LSMLAnimateDirective {
  transition?: {
    duration?: number;
    easing?: "linear" | "ease-in" | "ease-out" | "ease-in-out" | "spring";
    stiffness?: number;
    damping?: number;
  };
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

export interface LSMLBaseNode {
  kind: LSMLPrimitiveKind;
  id?: string;
  bind?: LSMLBindObject;
  bindStyle?: Record<string, string>;
  animate?: LSMLAnimateDirective;
  children?: LSMLNode[];
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
    fontWeight?: number;
    color?: string;
    textAlign?: "start" | "center" | "end" | "left" | "right";
    lineHeight?: number;
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

export type LSMLNode =
  | LSMLStack
  | LSMLGrid
  | LSMLFrame
  | LSMLText
  | LSMLImage
  | LSMLShape
  | LSMLMedia
  | LSMLRepeat;

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
  lsml: "1.0";
  scene_id: string;
  scene_version: string;
  layout: LSMLNode;
  operator_inputs?: LSMLOperatorInput[];
  external_adapters?: unknown[];
  defaults?: Record<string, unknown>;
  assets?: { allowedHosts?: string[]; fonts?: unknown[]; preload?: string[] };
  i18n?: { default_locale?: string; locales?: Record<string, Record<string, string>> };
  metadata?: Record<string, unknown>;
}
