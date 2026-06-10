import { motion } from "framer-motion";
import type { PrimitiveProps } from "./index";
import { toFramer, mountPlay, resolveTransition } from "../../animate/transitions";
import { parseCssColor, warnRejectedColor } from "../css-color";
import { emitDiagnostic } from "../diagnostics";

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

// ── Defence-in-depth upper bounds (issue #34, Bastion follow-up on
// PR #38) ─────────────────────────────────────────────────────────────
// The numeric typo fields were type-validated but unbounded ; an absurd
// value pushed by a hostile bundle or live delta could degrade layout /
// rendering (e.g. a 10⁹-line clamp or a kilometric letter spacing).
// Policy : a value beyond its cap is REJECTED (diagnostic + omit → CSS
// initial), consistent with the existing typo grammar gates — NOT
// clamped, unlike the R8 filter caps where the spec explicitly blesses
// clamping. Rationale : there is no "nearest sensible rendering" for an
// absurd typographic value, the author's intent is unknowable ; safe
// default beats silently-altered output.
/** Max `maxLines` accepted (Bastion suggested ≤ 1000 on PR #38). */
export const MAX_MAX_LINES = 1000;
/** Max unitless `lineHeight` multiplier (100× the font size is already
 *  far beyond any broadcast layout). */
export const MAX_LINE_HEIGHT = 100;
/** Max |letterSpacing| in px, both directions (±1000 px covers any
 *  legitimate broadcast typography). */
export const MAX_LETTER_SPACING_PX = 1000;

// ── fontFamily policy (issue #34, Bastion follow-up on PR #38) ───────
// Decision : SHAPE validation, not a font allowlist. `fontFamily` is
// assigned through the React style object (per-property assignment via
// CSSStyleDeclaration), which cannot break out of the declaration — so
// the residual risk is malformed CSS, not injection. A font allowlist
// would couple the runtime to a host-specific font inventory (a spec /
// RFC matter — flagged for Atlas in the PR), whereas shape validation
// keeps any legitimate family name working. The grammar accepts
// comma-separated family lists with optional quotes ; the injection
// metacharacters (`;` `}` `{` `:` `\` `<` `>` `(` `)`) and `url(` are
// rejected by construction (none of their characters are allowed).
// Anchored, single character class with a bounded quantifier — linear
// time (RC#12).
const FONT_FAMILY_RE = /^[a-zA-Z0-9 ,.'"_-]{1,256}$/;

/** Validate an untrusted `fontFamily` value. Returns the string or
 *  `null` on rejection (handled as "omit → inherit", with diagnostic). */
export function parseFontFamily(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v.length === 0) return null;
  return FONT_FAMILY_RE.test(v) ? v : null;
}

/** Text leaf. Value renders as the displayed string ; style props
 *  cover the full LSML TextStyle (size / font / weight / colour /
 *  alignment / lineHeight / letterSpacing / textTransform /
 *  textDecoration / fontStyle) plus `maxLines` (§4.4 ellipsis
 *  truncation). Opacity is animated when a transition is declared on
 *  `opacity` or `value`. An `animate.from` makes it mount-play
 *  (initial → target) on mount. */
export function Text({ resolved, nodeId, transitionFor, animateInitial }: PrimitiveProps) {
  const value = resolved.value === undefined ? "" : String(resolved.value);
  const size = (resolved.size as string | number | undefined) ?? "1rem";
  const weight = (resolved.weight as number | undefined) ?? 400;
  // Issue #34 — `font` is untrusted and lands in inline CSS : shape-
  // validate (see fontFamily policy above) ; rejected → inherit.
  let font: string | undefined;
  if (resolved.font !== undefined) {
    const parsed = parseFontFamily(resolved.font);
    if (parsed === null) {
      emitDiagnostic(nodeId, "text.font", "rejected fontFamily : outside the family-list grammar");
    } else {
      font = parsed;
    }
  }
  // RC#11 : `colour` is untrusted (static prop OR live LSDP delta) and
  // lands in inline CSS — strict-parse ; rejected → safe default.
  let colour = "currentColor";
  if (resolved.colour !== undefined) {
    const parsed = parseCssColor(resolved.colour);
    if (parsed === null) {
      warnRejectedColor("text.colour", nodeId);
    } else {
      colour = parsed;
    }
  }
  const align = (resolved.align as string | undefined) ?? "start";
  const opacity = numberOr(resolved.opacity, 1);
  const typography = resolveTypography(resolved, nodeId);

  const tx = resolveTransition(transitionFor, ["opacity", "value"], animateInitial);
  const play = mountPlay({ opacity }, animateInitial, nodeId);

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
 * numbers — never the raw input. Numeric fields additionally enforce
 * the defence-in-depth caps above (issue #34).
 */
export function resolveTypography(
  resolved: Record<string, unknown>,
  nodeId?: string,
): React.CSSProperties {
  // schema.json : lineHeight is a unitless multiplier ≥ 0 ;
  // letterSpacing is a number (px) ; the three enums are closed sets.
  const lineHeight = boundedNumber(
    resolved.lineHeight,
    0,
    MAX_LINE_HEIGHT,
    "text.lineHeight",
    nodeId,
  );
  const letterSpacing = boundedNumber(
    resolved.letterSpacing,
    -MAX_LETTER_SPACING_PX,
    MAX_LETTER_SPACING_PX,
    "text.letterSpacing",
    nodeId,
  );
  const textTransform = enumValue(
    resolved.textTransform,
    TEXT_TRANSFORMS,
    "text.textTransform",
    nodeId,
  );
  const textDecoration = enumValue(
    resolved.textDecoration,
    TEXT_DECORATIONS,
    "text.textDecoration",
    nodeId,
  );
  const fontStyle = enumValue(resolved.fontStyle, FONT_STYLES, "text.fontStyle", nodeId);
  // §4.4 maxLines — truncation with ellipsis after N lines, via the
  // standard line-clamp pattern (display:-webkit-box overrides the
  // base inline-block ; this fragment is spread after it so it wins).
  const maxLines = positiveInteger(resolved.maxLines, MAX_MAX_LINES, "text.maxLines", nodeId);

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
function enumValue(
  v: unknown,
  allow: ReadonlySet<string>,
  field: string,
  nodeId?: string,
): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "string" && allow.has(v)) return v;
  warnRejectedTypo(field, nodeId);
  return undefined;
}

/** Finite number within [min, max] or omit (R9 diagnostic on a
 *  non-conforming or out-of-cap input — rejected, never clamped). */
function boundedNumber(
  v: unknown,
  min: number,
  max: number,
  field: string,
  nodeId?: string,
): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max) return v;
  warnRejectedTypo(field, nodeId);
  return undefined;
}

/** Integer in [1, max] or omit (schema : maxLines is a line count ;
 *  capped per the issue #34 defence-in-depth bounds). */
function positiveInteger(
  v: unknown,
  max: number,
  field: string,
  nodeId?: string,
): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max) return v;
  warnRejectedTypo(field, nodeId);
  return undefined;
}

/**
 * Diagnostic for a typo value outside its spec'd grammar or caps.
 * Bastion R9 (ADR 001 §5.1) : the rejected VALUE is never logged nor
 * forwarded — only `node.id` (RC#7), the field name and a static
 * reason. Routed through the structured diagnostics channel.
 */
function warnRejectedTypo(field: string, nodeId?: string): void {
  emitDiagnostic(
    nodeId,
    field,
    "rejected typography value : outside the field's spec'd grammar or caps",
  );
}
