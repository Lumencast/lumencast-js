// sRGB colour interpolation (LSML 1.1 §6.5) — issue #33.
//
// Both endpoints of a colour animation are first CANONICALISED through
// the strict shared parser (`parseCssColor`, css-color.ts — ADR 001
// RC#11/RC#12, never a raw string), then converted to RGBA channels in
// [0, 1] and interpolated component-wise :
//
//   out_c = a_c + t * (b_c - a_c)   for c ∈ {r, g, b, a}
//
// with `t` produced by the easing curve. The output is serialised back
// to `rgba()` form — which itself round-trips through `parseCssColor`
// at the consuming primitive (belt and braces).
//
// All conversions are constant-time per value (the parser already
// bounds inputs to 64 chars) ; the named-colour table is a flat map
// lookup.

import { parseCssColor } from "./css-color";

/** RGBA channels, each in [0, 1]. */
export type Rgba = readonly [number, number, number, number];

// CSS Color 4 §6.1 named colours → packed 0xRRGGBB. Kept numeric (not
// hex strings) to minimise bundle weight ; the set of NAMES here is
// exactly the set accepted by css-color.ts (`transparent` and
// `currentcolor` are handled separately — `currentcolor` cannot be
// interpolated without computed-style context and is rejected).
const NAMED_RGB: Record<string, number> = {
  aliceblue: 0xf0f8ff,
  antiquewhite: 0xfaebd7,
  aqua: 0x00ffff,
  aquamarine: 0x7fffd4,
  azure: 0xf0ffff,
  beige: 0xf5f5dc,
  bisque: 0xffe4c4,
  black: 0x000000,
  blanchedalmond: 0xffebcd,
  blue: 0x0000ff,
  blueviolet: 0x8a2be2,
  brown: 0xa52a2a,
  burlywood: 0xdeb887,
  cadetblue: 0x5f9ea0,
  chartreuse: 0x7fff00,
  chocolate: 0xd2691e,
  coral: 0xff7f50,
  cornflowerblue: 0x6495ed,
  cornsilk: 0xfff8dc,
  crimson: 0xdc143c,
  cyan: 0x00ffff,
  darkblue: 0x00008b,
  darkcyan: 0x008b8b,
  darkgoldenrod: 0xb8860b,
  darkgray: 0xa9a9a9,
  darkgreen: 0x006400,
  darkgrey: 0xa9a9a9,
  darkkhaki: 0xbdb76b,
  darkmagenta: 0x8b008b,
  darkolivegreen: 0x556b2f,
  darkorange: 0xff8c00,
  darkorchid: 0x9932cc,
  darkred: 0x8b0000,
  darksalmon: 0xe9967a,
  darkseagreen: 0x8fbc8f,
  darkslateblue: 0x483d8b,
  darkslategray: 0x2f4f4f,
  darkslategrey: 0x2f4f4f,
  darkturquoise: 0x00ced1,
  darkviolet: 0x9400d3,
  deeppink: 0xff1493,
  deepskyblue: 0x00bfff,
  dimgray: 0x696969,
  dimgrey: 0x696969,
  dodgerblue: 0x1e90ff,
  firebrick: 0xb22222,
  floralwhite: 0xfffaf0,
  forestgreen: 0x228b22,
  fuchsia: 0xff00ff,
  gainsboro: 0xdcdcdc,
  ghostwhite: 0xf8f8ff,
  gold: 0xffd700,
  goldenrod: 0xdaa520,
  gray: 0x808080,
  green: 0x008000,
  greenyellow: 0xadff2f,
  grey: 0x808080,
  honeydew: 0xf0fff0,
  hotpink: 0xff69b4,
  indianred: 0xcd5c5c,
  indigo: 0x4b0082,
  ivory: 0xfffff0,
  khaki: 0xf0e68c,
  lavender: 0xe6e6fa,
  lavenderblush: 0xfff0f5,
  lawngreen: 0x7cfc00,
  lemonchiffon: 0xfffacd,
  lightblue: 0xadd8e6,
  lightcoral: 0xf08080,
  lightcyan: 0xe0ffff,
  lightgoldenrodyellow: 0xfafad2,
  lightgray: 0xd3d3d3,
  lightgreen: 0x90ee90,
  lightgrey: 0xd3d3d3,
  lightpink: 0xffb6c1,
  lightsalmon: 0xffa07a,
  lightseagreen: 0x20b2aa,
  lightskyblue: 0x87cefa,
  lightslategray: 0x778899,
  lightslategrey: 0x778899,
  lightsteelblue: 0xb0c4de,
  lightyellow: 0xffffe0,
  lime: 0x00ff00,
  limegreen: 0x32cd32,
  linen: 0xfaf0e6,
  magenta: 0xff00ff,
  maroon: 0x800000,
  mediumaquamarine: 0x66cdaa,
  mediumblue: 0x0000cd,
  mediumorchid: 0xba55d3,
  mediumpurple: 0x9370db,
  mediumseagreen: 0x3cb371,
  mediumslateblue: 0x7b68ee,
  mediumspringgreen: 0x00fa9a,
  mediumturquoise: 0x48d1cc,
  mediumvioletred: 0xc71585,
  midnightblue: 0x191970,
  mintcream: 0xf5fffa,
  mistyrose: 0xffe4e1,
  moccasin: 0xffe4b5,
  navajowhite: 0xffdead,
  navy: 0x000080,
  oldlace: 0xfdf5e6,
  olive: 0x808000,
  olivedrab: 0x6b8e23,
  orange: 0xffa500,
  orangered: 0xff4500,
  orchid: 0xda70d6,
  palegoldenrod: 0xeee8aa,
  palegreen: 0x98fb98,
  paleturquoise: 0xafeeee,
  palevioletred: 0xdb7093,
  papayawhip: 0xffefd5,
  peachpuff: 0xffdab9,
  peru: 0xcd853f,
  pink: 0xffc0cb,
  plum: 0xdda0dd,
  powderblue: 0xb0e0e6,
  purple: 0x800080,
  rebeccapurple: 0x663399,
  red: 0xff0000,
  rosybrown: 0xbc8f8f,
  royalblue: 0x4169e1,
  saddlebrown: 0x8b4513,
  salmon: 0xfa8072,
  sandybrown: 0xf4a460,
  seagreen: 0x2e8b57,
  seashell: 0xfff5ee,
  sienna: 0xa0522d,
  silver: 0xc0c0c0,
  skyblue: 0x87ceeb,
  slateblue: 0x6a5acd,
  slategray: 0x708090,
  slategrey: 0x708090,
  snow: 0xfffafa,
  springgreen: 0x00ff7f,
  steelblue: 0x4682b4,
  tan: 0xd2b48c,
  teal: 0x008080,
  thistle: 0xd8bfd8,
  tomato: 0xff6347,
  turquoise: 0x40e0d0,
  violet: 0xee82ee,
  wheat: 0xf5deb3,
  white: 0xffffff,
  whitesmoke: 0xf5f5f5,
  yellow: 0xffff00,
  yellowgreen: 0x9acd32,
};

/**
 * Canonicalise + convert an untrusted colour value to RGBA channels in
 * [0, 1]. The value passes through `parseCssColor` FIRST — anything the
 * strict parser rejects converts to `null` here (never interpolate a
 * raw string, §6.5 step 1 / RC#11). `currentcolor` is also rejected :
 * it has no concrete channels without computed-style context.
 */
export function cssColorToRgba(value: unknown): Rgba | null {
  const v = parseCssColor(value);
  if (v === null) return null;

  if (v.startsWith("#")) return hexToRgba(v);

  if (v.startsWith("rgb")) {
    const body = v.slice(v.indexOf("(") + 1, -1);
    const parts = body.split(",").map((p) => p.trim());
    if (parts.length < 3) return null;
    const pct = parts[0]!.endsWith("%");
    const scale = pct ? 100 : 255;
    const r = channel(parts[0]!, scale);
    const g = channel(parts[1]!, scale);
    const b = channel(parts[2]!, scale);
    const a = parts.length > 3 ? alphaChannel(parts[3]!) : 1;
    if (r === null || g === null || b === null || a === null) return null;
    return [r, g, b, a];
  }

  if (v.startsWith("hsl")) {
    const body = v.slice(v.indexOf("(") + 1, -1);
    const parts = body.split(",").map((p) => p.trim());
    if (parts.length < 3) return null;
    const h = Number(parts[0]!.replace("deg", ""));
    const s = Number(parts[1]!.replace("%", "")) / 100;
    const l = Number(parts[2]!.replace("%", "")) / 100;
    const a = parts.length > 3 ? alphaChannel(parts[3]!) : 1;
    if (![h, s, l].every(Number.isFinite) || a === null) return null;
    const [r, g, b] = hslToRgb(h, s, l);
    return [r, g, b, a];
  }

  if (v === "transparent") return [0, 0, 0, 0];
  if (v === "currentcolor") return null;

  const packed = NAMED_RGB[v];
  if (packed === undefined) return null;
  return [((packed >> 16) & 0xff) / 255, ((packed >> 8) & 0xff) / 255, (packed & 0xff) / 255, 1];
}

function hexToRgba(v: string): Rgba | null {
  const h = v.slice(1);
  if (h.length === 3 || h.length === 4) {
    const r = parseInt(h[0]! + h[0]!, 16);
    const g = parseInt(h[1]! + h[1]!, 16);
    const b = parseInt(h[2]! + h[2]!, 16);
    const a = h.length === 4 ? parseInt(h[3]! + h[3]!, 16) : 255;
    return [r / 255, g / 255, b / 255, a / 255];
  }
  if (h.length === 6 || h.length === 8) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255;
    return [r / 255, g / 255, b / 255, a / 255];
  }
  return null;
}

function channel(token: string, scale: number): number | null {
  const n = Number(token.replace("%", ""));
  if (!Number.isFinite(n)) return null;
  return clamp01(n / scale);
}

function alphaChannel(token: string): number | null {
  const pct = token.endsWith("%");
  const n = Number(token.replace("%", ""));
  if (!Number.isFinite(n)) return null;
  return clamp01(pct ? n / 100 : n);
}

/** Standard HSL → RGB (CSS Color 4 §7.1). h in degrees, s/l in [0,1]. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [clamp01(r + m), clamp01(g + m), clamp01(b + m)];
}

/** Component-wise sRGB lerp (§6.5 step 2). `t` may overshoot (springs) ;
 *  channels clamp back into [0, 1] after mixing. */
export function mixRgba(a: Rgba, b: Rgba, t: number): Rgba {
  return [
    clamp01(a[0] + t * (b[0] - a[0])),
    clamp01(a[1] + t * (b[1] - a[1])),
    clamp01(a[2] + t * (b[2] - a[2])),
    clamp01(a[3] + t * (b[3] - a[3])),
  ];
}

/** Serialise RGBA back to `rgba()` form (§6.5 step 3). The output is
 *  always re-accepted by `parseCssColor` (integer channels, alpha with
 *  at most 4 decimals). */
export function serializeRgba(rgba: Rgba): string {
  const r = Math.round(clamp01(rgba[0]) * 255);
  const g = Math.round(clamp01(rgba[1]) * 255);
  const b = Math.round(clamp01(rgba[2]) * 255);
  // 4 decimals max so the alpha token matches the strict grammar.
  const a = Math.round(clamp01(rgba[3]) * 10000) / 10000;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
