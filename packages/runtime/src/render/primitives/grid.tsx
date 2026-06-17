import type { PrimitiveProps } from "./index";

/** CSS Grid container with declared rows / cols. */
export function Grid({ resolved, children, establishesContainingBlock }: PrimitiveProps) {
  const cols = (resolved.cols as string) ?? "1fr";
  const rows = (resolved.rows as string) ?? "auto";
  const gap = (resolved.gap as number | string | undefined) ?? 0;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: cols,
        gridTemplateRows: rows,
        gap,
        // ADR 002 §3.1 (D1) — establish a containing block for absolutely
        // placed children ; untouched for pure auto-layout grids (RC#2).
        ...(establishesContainingBlock ? { position: "relative" } : {}),
      }}
    >
      {children}
    </div>
  );
}
