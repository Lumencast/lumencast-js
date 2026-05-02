import type { PrimitiveProps } from "./index";

/** Vertical or horizontal flex container. Layout-only — bindings
 *  here are unusual but tolerated. */
export function Stack({ resolved, children }: PrimitiveProps) {
  const direction = (resolved.direction as string) ?? "vertical";
  const gap = numberOr(resolved.gap, 0);
  const align = (resolved.align as string) ?? "stretch";
  const justify = (resolved.justify as string) ?? "flex-start";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: direction === "horizontal" ? "row" : "column",
        gap,
        alignItems: align,
        justifyContent: justify,
      }}
    >
      {children}
    </div>
  );
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
