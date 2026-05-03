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

export interface FillStop {
  offset: number;
  color: string;
  opacity?: number;
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

/** Compile an array of Fill into a CSS `background-image` value usable
 * on a `<div>` (frame backgrounds — non-SVG context). Returns the CSS
 * string + opacity. Stops use percentages in CSS gradient syntax. */
export function backgroundsToCss(fills: Fill[]): CSSProperties {
  // Per §4.12, fills[0] renders on top — CSS background-image stacks
  // first → top-most. Match by passing in the same order.
  const layers = fills.map(fillToCss).filter(Boolean) as string[];
  if (layers.length === 0) return {};
  return { backgroundImage: layers.join(", ") };
}

function fillToCss(fill: Fill): string | null {
  if (fill.kind === "solid") {
    // Wrap solid in linear-gradient so it can stack with other layers.
    return `linear-gradient(${fill.color}, ${fill.color})`;
  }
  const stops = fill.stops
    .map((s) => {
      const c = s.opacity !== undefined ? cssWithOpacity(s.color, s.opacity) : s.color;
      return `${c} ${(s.offset * 100).toFixed(2)}%`;
    })
    .join(", ");
  if (fill.kind === "linear-gradient") {
    const angle = fill.angle_deg ?? 0;
    return `linear-gradient(${angle}deg, ${stops})`;
  }
  // radial-gradient
  const cx = (fill.center?.x ?? 0.5) * 100;
  const cy = (fill.center?.y ?? 0.5) * 100;
  return `radial-gradient(circle at ${cx}% ${cy}%, ${stops})`;
}

function cssWithOpacity(color: string, opacity: number): string {
  // Best-effort wrapper — for hex/rgb we can append alpha. For
  // unrecognised forms, fall back to color-mix.
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const a = Math.round(opacity * 255)
      .toString(16)
      .padStart(2, "0");
    return `#${hex[1]}${a}`;
  }
  return `color-mix(in srgb, ${color} ${opacity * 100}%, transparent)`;
}

/** Coerce loose JSON into a Fill array. Returns [] for non-arrays. */
export function parseFills(value: unknown): Fill[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isFill) as Fill[];
}

function isFill(v: unknown): v is Fill {
  if (typeof v !== "object" || v === null) return false;
  const k = (v as { kind?: unknown }).kind;
  return k === "solid" || k === "linear-gradient" || k === "radial-gradient";
}
