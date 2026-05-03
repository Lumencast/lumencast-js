import type { CSSProperties } from "react";
import type { PrimitiveProps } from "./index";

/** Vertical or horizontal flex container. Layout-only — bindings
 *  here are unusual but tolerated.
 *
 *  LSML 1.1 §4.1 adds `wrap` (boolean) and `crossGap` (number) :
 *    - wrap: true sets `flex-wrap: wrap` so children flow onto the
 *      next row / column when they overflow the main axis.
 *    - crossGap is the spacing between rows / columns when wrapping.
 *      Mapped to CSS `row-gap` (horizontal stack) or `column-gap`
 *      (vertical stack). Ignored when `wrap` is false.
 */
export function Stack({ resolved, children }: PrimitiveProps) {
  const direction = (resolved.direction as string) ?? "vertical";
  const gap = numberOr(resolved.gap, 0);
  const wrap = resolved.wrap === true;
  const crossGap = numberOr(resolved.crossGap, 0);
  const align = (resolved.align as string) ?? "stretch";
  const justify = (resolved.justify as string) ?? "flex-start";
  const isHorizontal = direction === "horizontal";

  const style: CSSProperties = {
    display: "flex",
    flexDirection: isHorizontal ? "row" : "column",
    alignItems: align,
    justifyContent: justify,
  };

  if (wrap) {
    style.flexWrap = "wrap";
    if (isHorizontal) {
      style.columnGap = gap;
      style.rowGap = crossGap;
    } else {
      style.rowGap = gap;
      style.columnGap = crossGap;
    }
  } else {
    style.gap = gap;
  }

  return <div style={style}>{children}</div>;
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
