// Fill rendering helpers (LSML 1.1 §4.12).
//
// A Fill is a discriminated union :
//   - solid           : { kind: "solid", color, opacity? }
//   - linear-gradient : { kind: "linear-gradient", angle_deg?, stops, opacity? }
//   - radial-gradient : { kind: "radial-gradient", center?, radius?, stops, opacity? }
//
// shape.fills[] and frame.backgrounds[] both use this shape. Each fill
// renders as a separate SVG element layered top-to-bottom (first entry
// renders on top per §4.12).

import type { CSSProperties, ReactElement } from "react";
import { parseCssColor, warnRejectedColor } from "./css-color";
import { emitDiagnostic } from "./diagnostics";
import { gateSrc } from "./allowed-hosts";

export interface FillStop {
  offset: number;
  color: string;
  opacity?: number;
}

/** LSML 1.2 §3.2 closed `objectFit` enum, re-validated at the RUNTIME (the
 *  compiler is the other arm of the double-gate, Bastion T4). These are
 *  exactly the legal CSS `object-fit` / `background-size`-mappable values ;
 *  anything else is omitted + diagnosed, never passed through to inline CSS.
 *  Kept local to the runtime — the runtime must not import from the
 *  compiler (the dependency edge points the other way). */
const OBJECT_FITS = new Set(["cover", "contain", "fill", "none", "scale-down"]);

export type ObjectFit = "cover" | "contain" | "fill" | "none" | "scale-down";

/** Validate an `objectFit` against the closed enum at render. Returns the
 *  value or `undefined` (caller falls back to the default + diagnoses).
 *  Never passthrough. */
export function parseObjectFitRuntime(value: unknown): ObjectFit | undefined {
  return typeof value === "string" && OBJECT_FITS.has(value) ? (value as ObjectFit) : undefined;
}

export type Fill =
  | { kind: "solid"; color: string; opacity?: number }
  | {
      kind: "linear-gradient";
      angle_deg?: number;
      stops: FillStop[];
      opacity?: number;
    }
  | {
      kind: "radial-gradient";
      center?: { x: number; y: number };
      radius?: number;
      stops: FillStop[];
      opacity?: number;
    }
  | {
      // LSML 1.2 §3.2 — first-class image-fill. `src` is untrusted and is
      // host/scheme-gated by `gateImageFills` BEFORE this fill is ever
      // rendered (Bastion T1/T2). `objectFit` is the runtime-revalidated
      // closed-enum value (T4).
      kind: "image";
      src: string;
      objectFit?: ObjectFit;
      opacity?: number;
    };

let gradientIdSeq = 0;
function nextGradientId(): string {
  gradientIdSeq = (gradientIdSeq + 1) % 1_000_000;
  return `lumen-grad-${gradientIdSeq.toString(36)}`;
}

export interface FillRenderResult {
  /** SVG <defs> contributions (gradient definitions). */
  defs: ReactElement[];
  /** Reference to use as the `fill` attribute on the shape. */
  ref: string;
}

/** Compile a Fill into an SVG `<defs>` entry + a `fill="url(#…)"` ref.
 * Solid fills produce no defs and return the colour directly. */
export function renderFill(fill: Fill): FillRenderResult {
  if (fill.kind === "solid") {
    // Solid fill — no defs needed, just hand the colour to fill.
    // SVG fill-opacity composes with element opacity multiplicatively
    // so we apply both consistently.
    return { defs: [], ref: fill.color };
  }
  if (fill.kind === "image") {
    // LSML 1.2 §3.2 — image-fill on a shape. Rendered as an SVG <pattern>
    // holding a single <image> that fills the object bounding box ;
    // `preserveAspectRatio` reproduces the closed-enum `objectFit`. `src`
    // is pre-gated (T1/T2) by `gateImageFills`, so it is safe to place on
    // the SVG <image href>. No bundle-derived markup is interpolated — only
    // the URL string and closed-enum-derived attribute values.
    const imgId = nextGradientId();
    const par = objectFitToPreserveAspectRatio(fill.objectFit);
    const defs = [
      <pattern key={imgId} id={imgId} patternContentUnits="objectBoundingBox" width="1" height="1">
        <image href={fill.src} width="1" height="1" preserveAspectRatio={par} />
      </pattern>,
    ];
    return { defs, ref: `url(#${imgId})` };
  }
  const id = nextGradientId();
  if (fill.kind === "linear-gradient") {
    // angle_deg : 0 = bottom-to-top per §4.12 (matches CSS `linear-gradient`)
    const angle = fill.angle_deg ?? 0;
    // Translate angle (degrees from up) to SVG x1/y1/x2/y2 in user space.
    const rad = ((angle - 90) * Math.PI) / 180; // 0° → x1=0,y1=1 (bottom-up)
    const x1 = 0.5 - 0.5 * Math.cos(rad);
    const y1 = 0.5 - 0.5 * Math.sin(rad);
    const x2 = 0.5 + 0.5 * Math.cos(rad);
    const y2 = 0.5 + 0.5 * Math.sin(rad);
    const defs = [
      <linearGradient
        key={id}
        id={id}
        x1={`${x1 * 100}%`}
        y1={`${y1 * 100}%`}
        x2={`${x2 * 100}%`}
        y2={`${y2 * 100}%`}
      >
        {fill.stops.map((s, i) => (
          <stop
            key={i}
            offset={s.offset}
            stopColor={s.color}
            {...(s.opacity !== undefined ? { stopOpacity: s.opacity } : {})}
          />
        ))}
      </linearGradient>,
    ];
    return { defs, ref: `url(#${id})` };
  }
  // radial-gradient
  const cx = fill.center?.x ?? 0.5;
  const cy = fill.center?.y ?? 0.5;
  const r = fill.radius ?? 0.5;
  const defs = [
    <radialGradient key={id} id={id} cx={`${cx * 100}%`} cy={`${cy * 100}%`} r={`${r * 100}%`}>
      {fill.stops.map((s, i) => (
        <stop
          key={i}
          offset={s.offset}
          stopColor={s.color}
          {...(s.opacity !== undefined ? { stopOpacity: s.opacity } : {})}
        />
      ))}
    </radialGradient>,
  ];
  return { defs, ref: `url(#${id})` };
}

/** Map a closed-enum `objectFit` to the CSS `background-size` keyword that
 *  reproduces the same fit for a `background-image`. `fill`/`none`/`scale-
 *  down` have no exact 1:1 `background-size` keyword — we approximate with
 *  the nearest safe keyword (all from the closed enum, never free input). */
function objectFitToBackgroundSize(fit: ObjectFit | undefined): string {
  switch (fit) {
    case "contain":
    case "scale-down":
      return "contain";
    case "none":
      return "auto";
    case "fill":
      return "100% 100%";
    case "cover":
    default:
      return "cover";
  }
}

/** Map a closed-enum `objectFit` to the SVG `<image preserveAspectRatio>`
 *  value that reproduces the same fit inside a pattern tile. Every returned
 *  value is a fixed literal (closed enum → fixed mapping) — never free
 *  input reaching an SVG attribute. */
function objectFitToPreserveAspectRatio(fit: ObjectFit | undefined): string {
  switch (fit) {
    case "contain":
    case "scale-down":
      return "xMidYMid meet";
    case "fill":
      return "none";
    case "none":
      return "xMidYMid meet";
    case "cover":
    default:
      return "xMidYMid slice";
  }
}

/** Compile an array of Fill into background CSS usable on a `<div>` (frame
 * backgrounds — non-SVG context). Returns `backgroundImage` plus, when an
 * image-fill is present, the matching `backgroundSize`/`backgroundPosition`/
 * `backgroundRepeat`. Stops use percentages in CSS gradient syntax.
 *
 * Image-fill `src` MUST already be host/scheme-gated (`gateImageFills`) —
 * `backgroundsToCss` assumes the URL is trusted at this point and only
 * CSS-escapes it for safe interpolation into `url("…")`. */
export function backgroundsToCss(fills: Fill[], nodeId?: string): CSSProperties {
  // Per §4.12, fills[0] renders on top — CSS background-image stacks
  // first → top-most. Match by passing in the same order.
  const layers = fills.map((f) => fillToCss(f, nodeId)).filter(Boolean) as string[];
  if (layers.length === 0) return {};
  const css: CSSProperties = { backgroundImage: layers.join(", ") };
  // When any layer is an image-fill, drive its sizing from the (already
  // validated) objectFit. A single image-fill is the common cover case ;
  // for the first image-fill we set the background sizing for the whole box.
  const firstImage = fills.find((f) => f.kind === "image") as
    | Extract<Fill, { kind: "image" }>
    | undefined;
  if (firstImage) {
    css.backgroundSize = objectFitToBackgroundSize(firstImage.objectFit);
    css.backgroundPosition = "center";
    css.backgroundRepeat = "no-repeat";
  }
  return css;
}

/** CSS-escape a (already host-gated) URL for safe interpolation into a
 *  `url("…")` token — escape backslash and the double-quote that would
 *  otherwise break out of the quoted string. */
function cssUrl(src: string): string {
  return `url("${src.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")`;
}

function fillToCss(fill: Fill, nodeId?: string): string | null {
  if (fill.kind === "image") {
    // `src` is pre-gated (T1/T2) by `gateImageFills` ; only escape it for
    // the CSS string context here.
    return cssUrl(fill.src);
  }
  // RC#11 — every colour interpolated into an inline CSS string MUST
  // pass the strict parser first (fills/stops arrive from untrusted
  // bundles AND live LSDP deltas). A rejected colour drops the whole
  // layer : never passthrough, never a half-built gradient.
  if (fill.kind === "solid") {
    const color = parseCssColor(fill.color);
    if (color === null) {
      warnRejectedColor("fill.color", nodeId);
      return null;
    }
    // Wrap solid in linear-gradient so it can stack with other layers.
    return `linear-gradient(${color}, ${color})`;
  }
  const safeStops: string[] = [];
  for (const s of fill.stops) {
    const color = parseCssColor(s.color);
    if (color === null) {
      warnRejectedColor("fill.stops.color", nodeId);
      return null;
    }
    const c = s.opacity !== undefined ? cssWithOpacity(color, s.opacity) : color;
    safeStops.push(`${c} ${(s.offset * 100).toFixed(2)}%`);
  }
  const stops = safeStops.join(", ");
  if (fill.kind === "linear-gradient") {
    const angle = fill.angle_deg ?? 0;
    return `linear-gradient(${angle}deg, ${stops})`;
  }
  // radial-gradient
  const cx = (fill.center?.x ?? 0.5) * 100;
  const cy = (fill.center?.y ?? 0.5) * 100;
  return `radial-gradient(circle at ${cx}% ${cy}%, ${stops})`;
}

/** Apply a stop opacity to an ALREADY-VALIDATED colour (callers must
 * have run `parseCssColor` first — fillToCss is the single entry).
 * For 6-digit hex we append the alpha byte ; every other accepted
 * form goes through color-mix, which is safe because the interpolated
 * string can only be a strict-grammar colour (RC#11 fix : this used
 * to interpolate the raw, unparsed input). */
function cssWithOpacity(color: string, opacity: number): string {
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const a = Math.round(opacity * 255)
      .toString(16)
      .padStart(2, "0");
    return `#${hex[1]}${a}`;
  }
  return `color-mix(in srgb, ${color} ${opacity * 100}%, transparent)`;
}

/** Validate every colour carried by a Fill array through the strict
 * parser (RC#11 — issue #30 contractual comment : SVG `fill`/`stroke`
 * attributes and `<stop stop-color>` are injection sites too, since
 * fills arrive from untrusted bundles AND live LSDP deltas). A fill
 * whose solid colour — or ANY gradient stop colour — is rejected drops
 * the whole layer with a diagnostic : never passthrough, never a
 * half-built gradient. Returned fills carry canonicalised colours. */
export function sanitizeFills(fills: Fill[], field: string, nodeId?: string): Fill[] {
  const out: Fill[] = [];
  for (const fill of fills) {
    // Image-fills carry no colour — they are colour-clean by construction.
    // Their `src` is gated separately (`gateImageFills`, T1/T2) ; pass them
    // through here unchanged so `sanitizeFills` only owns colour validation.
    if (fill.kind === "image") {
      out.push(fill);
      continue;
    }
    if (fill.kind === "solid") {
      const color = parseCssColor(fill.color);
      if (color === null) {
        warnRejectedColor(`${field}.color`, nodeId);
        continue;
      }
      out.push({ ...fill, color });
      continue;
    }
    const stops: FillStop[] = [];
    let rejected = false;
    for (const s of fill.stops ?? []) {
      const color = parseCssColor(s.color);
      if (color === null) {
        warnRejectedColor(`${field}.stops.color`, nodeId);
        rejected = true;
        break;
      }
      stops.push({ ...s, color });
    }
    if (rejected) continue;
    out.push({ ...fill, stops });
  }
  return out;
}

/** Coerce loose JSON into a Fill array. Returns [] for non-arrays.
 * A structurally-valid fill entry whose `kind` is not renderable by
 * this runtime (e.g. `angular-gradient` / `diamond-gradient`, promoted
 * to core by the LSML 1.2 RFC) is dropped WITH a diagnostic — never
 * silently (ADR 001 §3.4, issue #34). */
export function parseFills(value: unknown, field?: string, nodeId?: string): Fill[] {
  if (!Array.isArray(value)) return [];
  if (field !== undefined) {
    for (const v of value) {
      if (!isFill(v)) {
        emitDiagnostic(
          nodeId,
          `${field}.kind`,
          "fill kind is not renderable by this runtime ; layer dropped (angular/diamond gradients land with LSML 1.2)",
        );
      }
    }
  }
  // Image-fill `objectFit` is re-validated against the closed enum here
  // (Bastion T4 runtime arm) : a hostile / unknown value is dropped with a
  // diagnostic and the fill falls back to the default fit — never passed
  // through to inline CSS. `src` is NOT gated here (it needs the host
  // allowlist) — `gateImageFills` does that downstream, before render.
  return value.filter(isFill).map((v) => {
    const fill = v as Fill;
    if (fill.kind !== "image") return fill;
    if (fill.objectFit === undefined) return fill;
    const fit = parseObjectFitRuntime(fill.objectFit);
    if (fit === undefined) {
      emitDiagnostic(
        nodeId,
        field !== undefined ? `${field}.objectFit` : "fill.objectFit",
        "is not a recognised object-fit ; falling back to default (ADR 002 §3.2)",
      );
      const { objectFit: _drop, ...rest } = fill;
      return rest;
    }
    return { ...fill, objectFit: fit };
  });
}

function isFill(v: unknown): v is Fill {
  if (typeof v !== "object" || v === null) return false;
  const k = (v as { kind?: unknown }).kind;
  if (k === "solid" || k === "linear-gradient" || k === "radial-gradient") return true;
  // An image-fill must carry a string `src` to be structurally valid ; a
  // malformed image entry is dropped like any other unrenderable fill.
  return k === "image" && typeof (v as { src?: unknown }).src === "string";
}

/**
 * Drop every image-fill whose `src` fails the host/scheme allowlist
 * (Bastion T1/T2), BEFORE any image-fill reaches the DOM. A rejected
 * image-fill is omitted entirely (never a passthrough URL) with an
 * R9-clean diagnostic emitted by `gateSrc`. Non-image fills pass through
 * untouched. Call this once, after `parseFills`, with the active
 * `allowedHosts` from `useAllowedHosts()`.
 */
export function gateImageFills(
  fills: Fill[],
  allowedHosts: readonly string[] | undefined,
  field: string,
  nodeId?: string,
): Fill[] {
  return fills.filter((fill) => {
    if (fill.kind !== "image") return true;
    return gateSrc(fill.src, allowedHosts, `${field}.src`, nodeId) !== undefined;
  });
}
