import { motion } from "framer-motion";
import type { PrimitiveProps } from "./index";
import { toFramer, mountPlay, resolveTransition } from "../../animate/transitions";
import { parseCssColor, warnRejectedColor } from "../css-color";

// ── Typography grammars (LSML 1.1 TextStyle, schema.json) ───────────
// Every typo prop is wire-drivable (static bundle prop OR live LSDP
// delta via `resolveProps`, tree.tsx) and lands in inline CSS, so each
// value is validated against the field's spec'd grammar before it may
// reach the style object. Enum fields go through a closed allowlist
// (the emitted string is always one of these constants — never the
// input), numeric fields through finite-number checks. There is NO
// string passthrough on any of these sites (ADR 001 RC#11 by
// construction : no untrusted string ever reaches the style object).
const TEXT_TRANSFORMS = new Set(["none", "uppercase", "lowercase", "capitalize"]);
const TEXT_DECORATIONS = new Set(["none", "underline", "line-through"]);
const FONT_STYLES = new Set(["normal", "italic", "oblique"]);

/** Text leaf. Value renders as the displayed string ; style props
 *  cover the full LSML TextStyle (size / font / weight / colour /
 *  alignment / lineHeight / letterSpacing / textTransform /
 *  textDecoration / fontStyle) plus `maxLines` (§4.4 ellipsis
 *  truncation). Opacity is animated when a transition is declared on
 *  `opacity` or `value`. An `animate.from` makes it mount-play
 *  (initial → target) on mount. */
export function Text({ resolved, transitionFor, animateInitial }: PrimitiveProps) {
  const value = resolved.value === undefined ? "" : String(resolved.value);
  const size = (resolved.size as string | number | undefined) ?? "1rem";
  const font = resolved.font as string | undefined;
  const weight = (resolved.weight as number | undefined) ?? 400;
  // RC#11 : `colour` is untrusted (static prop OR live LSDP delta) and
  // lands in inline CSS — strict-parse ; rejected → safe default.
  let colour = "currentColor";
  if (resolved.colour !== undefined) {
    const parsed = parseCssColor(resolved.colour);
    if (parsed === null) {
      warnRejectedColor("text.colour");
    } else {
      colour = parsed;
    }
  }
  const align = (resolved.align as string | undefined) ?? "start";
  const opacity = numberOr(resolved.opacity, 1);
  const typography = resolveTypography(resolved);

  const tx = resolveTransition(transitionFor, ["opacity", "value"], animateInitial);
  const play = mountPlay({ opacity }, animateInitial);

  return (
    <motion.span
      style={{
        display: "inline-block",
        fontSize: size,
        // `font` carries LSML text.style.fontFamily (spec'd in schema.json).
        // Omitted => inherit the host/container font.
        ...(font !== undefined ? { fontFamily: font } : {}),
        fontWeight: weight,
        color: colour,
        textAlign: align as React.CSSProperties["textAlign"],
        ...typography,
        willChange: "opacity, transform",
      }}
      initial={play.initial}
      animate={play.animate}
      transition={toFramer(tx)}
    >
      {value}
    </motion.span>
  );
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Resolve the LSML 1.1 TextStyle typography props (`lineHeight`,
 * `letterSpacing`, `textTransform`, `textDecoration`, `fontStyle`) and
 * `maxLines` (§4.4) into a validated React style fragment.
 *
 * Exported for boundary testing : happy-dom drops `-webkit-*`
 * declarations from `CSSStyleDeclaration`, so the line-clamp pattern is
 * asserted on the exact object handed to React's inline style (same
 * approach as `backgroundsToCss` for `color-mix`).
 *
 * Defaults = omit the declaration (inherit / CSS initial). A
 * non-conforming value → R9 diagnostic + omit ; the returned object
 * only ever contains allowlisted constants or validated finite
 * numbers — never the raw input.
 */
export function resolveTypography(resolved: Record<string, unknown>): React.CSSProperties {
  // schema.json : lineHeight is a unitless multiplier ≥ 0 ;
  // letterSpacing is a number (px) ; the three enums are closed sets.
  const lineHeight = nonNegativeNumber(resolved.lineHeight, "text.lineHeight");
  const letterSpacing = finiteNumber(resolved.letterSpacing, "text.letterSpacing");
  const textTransform = enumValue(resolved.textTransform, TEXT_TRANSFORMS, "text.textTransform");
  const textDecoration = enumValue(
    resolved.textDecoration,
    TEXT_DECORATIONS,
    "text.textDecoration",
  );
  const fontStyle = enumValue(resolved.fontStyle, FONT_STYLES, "text.fontStyle");
  // §4.4 maxLines — truncation with ellipsis after N lines, via the
  // standard line-clamp pattern (display:-webkit-box overrides the
  // base inline-block ; this fragment is spread after it so it wins).
  const maxLines = positiveInteger(resolved.maxLines, "text.maxLines");

  return {
    ...(lineHeight !== undefined ? { lineHeight } : {}),
    // Built from a validated finite number — no string passthrough.
    ...(letterSpacing !== undefined ? { letterSpacing: `${letterSpacing}px` } : {}),
    ...(textTransform !== undefined
      ? { textTransform: textTransform as React.CSSProperties["textTransform"] }
      : {}),
    ...(textDecoration !== undefined ? { textDecoration } : {}),
    ...(fontStyle !== undefined ? { fontStyle } : {}),
    ...(maxLines !== undefined
      ? {
          display: "-webkit-box",
          WebkitBoxOrient: "vertical" as const,
          WebkitLineClamp: maxLines,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }
      : {}),
  };
}

/** Closed-allowlist enum gate. Returns the canonical constant from the
 *  allowlist (NEVER the raw input) or `undefined` (field omitted →
 *  CSS initial). Non-conforming value → R9 diagnostic, no passthrough. */
function enumValue(v: unknown, allow: ReadonlySet<string>, field: string): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "string" && allow.has(v)) return v;
  warnRejectedTypo(field);
  return undefined;
}

/** Finite number or omit (with R9 diagnostic on non-conforming input). */
function finiteNumber(v: unknown, field: string): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  warnRejectedTypo(field);
  return undefined;
}

/** Finite number ≥ 0 or omit (schema : lineHeight minimum 0). */
function nonNegativeNumber(v: unknown, field: string): number | undefined {
  const n = finiteNumber(v, field);
  if (n === undefined) return undefined;
  if (n < 0) {
    warnRejectedTypo(field);
    return undefined;
  }
  return n;
}

/** Integer ≥ 1 or omit (schema : maxLines is a line count). */
function positiveInteger(v: unknown, field: string): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "number" && Number.isInteger(v) && v >= 1) return v;
  warnRejectedTypo(field);
  return undefined;
}

/**
 * Diagnostic for a typo value outside its spec'd grammar. Bastion R9
 * (ADR 001 §5.1) : the rejected VALUE is never logged nor forwarded —
 * only the field name and a static reason. DEV-only, consistent with
 * `warnRejectedColor` (no logs in `broadcast` builds).
 */
function warnRejectedTypo(field: string): void {
  if (import.meta.env.DEV) {
    console.warn(
      `[lumencast] rejected typography value for "${field}" : ` +
        "outside the field's spec'd grammar (value withheld per R9)",
    );
  }
}
