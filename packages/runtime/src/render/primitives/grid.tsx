import type { PrimitiveProps } from "./index";

/** CSS Grid container with declared rows / cols. */
export function Grid({ resolved, children }: PrimitiveProps) {
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
      }}
    >
      {children}
    </div>
  );
}
