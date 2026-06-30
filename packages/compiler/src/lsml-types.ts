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
//
// 1.2 additions (additive over 1.1 — a 1.1 bundle stays valid ; ADR 002 §3.2) :
//   - `blendMode` on every primitive (closed enum → CSS `mix-blend-mode`)
//   - `mask` on every primitive (typed fields, never a free SVG string)
//   - first-class image-fill variant on `LSMLFill` (`{ kind: "image"; … }`)
//     with a closed `objectFit` enum
//   - gradient `transform` (6 finite, bounded floats — never a free string)

/** 1.2+ — CSS `mix-blend-mode` value, restricted to the closed set faithful
 *  to Figma minus `PASS_THROUGH` (ADR 002 §3.2 ; Bastion T4). A value outside
 *  this set is a diagnostic + omission at the compiler, never passthrough. */
export type LSMLBlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity"
  | "plus-lighter";

/** 1.2+ — how an image-fill / image source is fitted into its box
 *  (closed enum → CSS `object-fit` ; ADR 002 §3.2 ; Bastion T4). */
export type LSMLObjectFit = "cover" | "contain" | "fill" | "none" | "scale-down";

/** 1.2+ — masking model (LSML §4.x, ADR 002 §3.2). A node carries a typed
 *  `mask` whose fields are ALL typed — there is deliberately NO free-form SVG
 *  string anywhere in this shape (Bastion T3 : the runtime builds `<mask>` /
 *  `<clipPath>` from these fields, never from author markup). */
export interface LSMLMask {
  /** What provides the mask coverage. A reference to a sibling shape (by id),
   *  an image asset URL, or a reference to a sibling GROUP/FRAME container (by
   *  id) whose visible children's geometry is composited (ADR 002 A4.3). A
   *  `kind: "image"` source is re-gated by the host/scheme allowlist (T1/T2)
   *  before it reaches the DOM. */
  source:
    | { kind: "shape"; ref: string }
    | { kind: "image"; src: string }
    | { kind: "group"; ref: string };
  /** Whether the mask reads the source's alpha channel or its luminance. */
  type: "alpha" | "luminance";
  /** Boolean composition op against the masked content. */
  op: "intersect" | "subtract" | "union";
  /** Optional placement of the mask source within the masked box. */
  position?: { x: number; y: number };
  /** Optional explicit size of the mask source. */
  size?: { w: number; h: number };
}

/** 1.2+ — a gradient `transform` : the 6 floats of an affine 2×3 matrix
 *  `[a, b, c, d, e, f]` (ADR 002 §3.2 ; Bastion T4). Carried as typed
 *  numbers, never a free string ; the compiler clamps each component to a
 *  finite, bounded value before it reaches `gradientTransform` SVG. */
export type LSMLGradientTransform = [number, number, number, number, number, number];

export type LSMLPrimitiveKind =
  | "stack"
  | "grid"
  | "frame"
  | "text"
  | "image"
  | "shape"
  | "media"
  | "repeat"
  | "instance"
  // Zab vendor primitive (RFC-0001, §17.1). Additive, vendor-prefixed ; a
  // transparent capture placeholder that acquires no stream.
  | "x-zab.capture"
  // Zab vendor primitive (ADR Blue 009 §3.1, Amendment 2). Additive,
  // vendor-prefixed ; a transparent slot placeholder that declares which
  // logical slot of the scene receives a meet peer. Carries NO cam/peer
  // identity — the slotRef→peer_label binding is stream-level ZabCam state,
  // resolved at runtime. Cam-agnostic by construction.
  | "x-zab.meet-peer";

/** RFC-0001 — the class of live capture a `x-zab.capture` box stands for. */
export type LSMLCaptureSourceKind =
  | "media.webcam"
  | "media.screen"
  | "media.window"
  | "media.app_audio"
  | "media.mic";

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
 *  (LSML §4.12). Discriminated on `kind`.
 *
 *  1.2+ (#L) — each variant may carry an optional `blendMode` (the closed
 *  `LSMLBlendMode` enum, no new value introduced) applied as a per-fill-layer
 *  `mix-blend-mode`, independent of the node-level blend (`LSMLBaseNode.
 *  blendMode`, #D). Absent = `normal` (rétro-compat : a pre-#L bundle is
 *  unchanged). Re-validated against the closed enum by both the compiler and
 *  the runtime (T4 double-gate) ; out-of-enum → omission, never passthrough. */
export type LSMLFill =
  | { kind: "solid"; color: string; opacity?: number; blendMode?: LSMLBlendMode }
  | {
      kind: "linear-gradient";
      angle_deg?: number;
      /** 1.2+ — full affine gradient transform (6 floats). When present it
       *  supersedes `angle_deg` (ADR 002 §3.2). */
      transform?: LSMLGradientTransform;
      stops: LSMLFillStop[];
      opacity?: number;
      blendMode?: LSMLBlendMode;
    }
  | {
      kind: "radial-gradient";
      center?: { x: number; y: number };
      radius?: number;
      /** 1.2+ — full affine gradient transform (6 floats). */
      transform?: LSMLGradientTransform;
      stops: LSMLFillStop[];
      opacity?: number;
      blendMode?: LSMLBlendMode;
    }
  | {
      /** 1.2+ — first-class image-fill (ADR 002 §3.2). Unifies the frame
       *  image-background and unblocks the shape image-fill that 1.1 dropped.
       *  `src` is host/scheme-allowlist-gated (T1/T2) before the DOM. */
      kind: "image";
      src: string;
      objectFit?: LSMLObjectFit;
      opacity?: number;
      transform?: LSMLGradientTransform;
      blendMode?: LSMLBlendMode;
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
    /** 1.1 §6.2 — spring mass (kg, default 1). Lowered into the
     *  runtime's `SpringTransition` (ADR 001 phase B, issue #33). */
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
  /** 1.1+ §6.3 — animation targets bound to leaf paths. Keys MUST
   *  reference animatable properties (the §6.1 list, plus the node
   *  kind's colour-typed property per §6.5) ; any other key is a hard
   *  compile error (ADR 001 §3.3 / RC#13 — throw, not warn). Lowered
   *  to the RenderNode `animateBindings` map. */
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
  /** Mirror the node vertically (`scaleY(-1)`) — from a negative Figma
   *  transform determinant. Composed with `rotation` at render. */
  flipY?: boolean;
  /** Figma LAYER_BLUR radius (px) → CSS `filter: blur()`. */
  blur?: number;
  /** Figma DROP_SHADOW / INNER_SHADOW → CSS `box-shadow` / `filter: drop-shadow`.
   *  Each layer is `{ inset?, color, x, y, blur, spread }` (colour strict-parsed
   *  runtime-side, RC#11). The picto square's depth halo + orange/red inner rim. */
  shadow?: Array<{
    inset?: boolean;
    color: string;
    x: number;
    y: number;
    blur: number;
    spread: number;
  }>;
  /** 1.1+ — per-axis sizing mode (LSML §5.4). */
  sizing?: { x?: "fixed" | "hug" | "fill"; y?: "fixed" | "hug" | "fill" };
  /** 1.1+ — universal position relative to parent (LSML §5.4). */
  position?: { x: number; y: number };
  /** 1.2+ — CSS `mix-blend-mode` (closed enum ; ADR 002 §3.2). A value
   *  outside `LSMLBlendMode` is a diagnostic + omission, never passthrough. */
  blendMode?: LSMLBlendMode;
  /** 1.2+ — typed mask spec (ADR 002 §3.2). Built into `<mask>`/`<clipPath>`
   *  by the runtime from typed fields — never from author SVG markup. */
  mask?: LSMLMask;
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
  /** Explicit box dimensions for a fixed-size auto-layout frame. Lowered to
   *  render `width`/`height` so a `sizing:fixed` stack establishes its box
   *  instead of collapsing to 0 (compile.ts case "stack"). */
  size?: { w: number; h: number };
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
  /** Figma `cornerRadius` (px) → canonical RenderNode `radius` (border-radius).
   *  The rounded picto square (r=111). */
  cornerRadius?: number;
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

/** RFC-0001 — `x-zab.capture` : a transparent capture placeholder (Zab
 *  vendor primitive, §17.1). Reserves a box and renders nothing ; carries a
 *  `sourceKind` and a logical, hash-safe `deviceRef`. Acquires no stream —
 *  physical device resolution lives entirely in the consuming app, never in
 *  Lumencast. Vendor props keep their `x-zab.` prefix verbatim. */
export interface LSMLCapture extends LSMLBaseNode {
  kind: "x-zab.capture";
  /** The class of live capture this box stands for. */
  "x-zab.sourceKind": LSMLCaptureSourceKind;
  /** A logical device alias (e.g. `primary-cam`). Matches
   *  `^[a-z][a-z0-9-]{0,63}$` — NEVER a physical device_id / UUID. */
  "x-zab.deviceRef": string;
  /** Box geometry. Required for visual `sourceKind`s
   *  (`media.webcam`/`media.screen`/`media.window`) ; audio-only kinds
   *  (`media.app_audio`/`media.mic`) may omit it (zero-area box). */
  size?: { w: number; h: number };
}

/** ADR Blue 009 §3.1 (Amendment 2) — `x-zab.meet-peer` : a transparent
 *  meet-peer SLOT placeholder (Zab vendor primitive, §17.1). Reserves a box
 *  and renders nothing until the slot is bound. Carries ONLY a logical,
 *  hash-safe `slotRef` (which slot of the scene receives a meet peer) and
 *  geometry — NEVER a cam/peer identity. The `slotRef → peer_label` binding
 *  is stream-level ZabCam state (table `slot_assignments`), resolved entirely
 *  at runtime ; Lumencast resolves no peer and the scene stays cam-agnostic.
 *  Vendor props keep their `x-zab.` prefix verbatim. */
export interface LSMLMeetPeer extends LSMLBaseNode {
  kind: "x-zab.meet-peer";
  /** A logical slot alias (e.g. `cam-caster-1`). Matches
   *  `^[a-z][a-z0-9-]{0,63}$` — NEVER a volatile peerId / room id. In the
   *  hash (structural slot identity). */
  "x-zab.slotRef": string;
  /** Box geometry. Required — a meet-peer slot is always a visual box that
   *  renders a transparent placeholder until bound. */
  size: { w: number; h: number };
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
  | LSMLInstance
  | LSMLCapture
  | LSMLMeetPeer;

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
  lsml: "1.0" | "1.1" | "1.2";
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
