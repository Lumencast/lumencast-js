import { useLumencastRuntime } from "./runtime-context";

const COLOURS: Record<string, string> = {
  live: "rgba(34, 197, 94, 0.85)",
  connecting: "rgba(234, 179, 8, 0.85)",
  disconnected: "rgba(239, 68, 68, 0.85)",
};

const LABELS: Record<string, string> = {
  live: "live",
  connecting: "reconnecting",
  disconnected: "disconnected",
};

export function StatusPill() {
  const { status } = useLumencastRuntime();
  return (
    <div
      data-testid="lumencast-status-pill"
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        padding: "4px 10px",
        fontSize: 11,
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        color: "white",
        background: COLOURS[status] ?? "#444",
        borderRadius: 999,
        userSelect: "none",
        pointerEvents: "none",
      }}
    >
      {LABELS[status] ?? status}
    </div>
  );
}
