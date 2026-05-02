import { useSignals } from "@preact/signals-react/runtime";
import type { OperatorInput } from "../render/bundle";
import { useLumencastRuntime } from "./runtime-context";

const PANEL_STYLE: React.CSSProperties = {
  position: "fixed",
  bottom: 12,
  left: 12,
  zIndex: 100_000,
  width: 320,
  maxHeight: "70vh",
  overflowY: "auto",
  padding: 12,
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  fontSize: 12,
  color: "#e5e7eb",
  background: "rgba(17, 24, 39, 0.92)",
  border: "1px solid rgba(75, 85, 99, 0.6)",
  borderRadius: 10,
  boxShadow: "0 8px 32px rgba(0, 0, 0, 0.45)",
};

const ROW_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: "6px 0",
  borderBottom: "1px solid rgba(75, 85, 99, 0.35)",
};

const LABEL_STYLE: React.CSSProperties = {
  color: "#9ca3af",
  fontSize: 10.5,
  letterSpacing: "0.02em",
  textTransform: "uppercase",
};

const INPUT_STYLE: React.CSSProperties = {
  background: "rgba(31, 41, 55, 0.8)",
  border: "1px solid rgba(75, 85, 99, 0.6)",
  borderRadius: 6,
  color: "#f9fafb",
  padding: "4px 6px",
  fontSize: 12,
  width: "100%",
};

export function ControlPanel() {
  const { bundle, store, sendInput } = useLumencastRuntime();
  useSignals();

  const inputs = bundle.operator_inputs ?? [];
  if (inputs.length === 0) return null;

  // Group entries by `group` field for readability.
  const groups = new Map<string, OperatorInput[]>();
  for (const entry of inputs) {
    const g = entry.group ?? "General";
    const list = groups.get(g) ?? [];
    list.push(entry);
    groups.set(g, list);
  }

  return (
    <div style={PANEL_STYLE} data-testid="lumencast-control-panel">
      <div
        style={{
          fontWeight: 600,
          fontSize: 11,
          letterSpacing: "0.06em",
          color: "#9ca3af",
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        Operator inputs
      </div>
      {[...groups.entries()].map(([group, entries]) => (
        <div key={group} style={{ marginBottom: 8 }}>
          <div
            style={{
              color: "#6b7280",
              fontSize: 10,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              padding: "4px 0",
            }}
          >
            {group}
          </div>
          {entries.map((entry) => (
            <InputRow
              key={entry.path}
              entry={entry}
              currentValue={store.signal(entry.path).value}
              onCommit={(v) =>
                // Operator-control values come from form widgets typed per
                // OperatorInput.type; coerce to LeafValue at the boundary.
                sendInput([
                  {
                    path: entry.path,
                    value: v as Parameters<typeof sendInput>[0][number]["value"],
                  },
                ])
              }
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function InputRow({
  entry,
  currentValue,
  onCommit,
}: {
  entry: OperatorInput;
  currentValue: unknown;
  onCommit: (value: unknown) => void;
}) {
  return (
    <div style={ROW_STYLE}>
      <span style={LABEL_STYLE}>{entry.label}</span>
      <Editor entry={entry} currentValue={currentValue} onCommit={onCommit} />
    </div>
  );
}

function Editor({
  entry,
  currentValue,
  onCommit,
}: {
  entry: OperatorInput;
  currentValue: unknown;
  onCommit: (value: unknown) => void;
}) {
  switch (entry.type) {
    case "boolean": {
      const checked = currentValue === true;
      return (
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={checked} onChange={(e) => onCommit(e.target.checked)} />
          <span style={{ fontSize: 11, color: "#d1d5db" }}>{checked ? "on" : "off"}</span>
        </label>
      );
    }
    case "number": {
      const min = entry.min as number | undefined;
      const max = entry.max as number | undefined;
      const step = entry.step as number | undefined;
      return (
        <input
          type="number"
          style={INPUT_STYLE}
          value={typeof currentValue === "number" ? currentValue : ""}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onCommit(n);
          }}
        />
      );
    }
    case "text": {
      const max = entry.max_length as number | undefined;
      return (
        <input
          type="text"
          style={INPUT_STYLE}
          value={typeof currentValue === "string" ? currentValue : ""}
          maxLength={max}
          onChange={(e) => onCommit(e.target.value)}
        />
      );
    }
    case "colour": {
      return (
        <input
          type="color"
          style={INPUT_STYLE}
          value={typeof currentValue === "string" ? currentValue : "#000000"}
          onChange={(e) => onCommit(e.target.value)}
        />
      );
    }
    case "duration": {
      return (
        <input
          type="number"
          style={INPUT_STYLE}
          value={typeof currentValue === "number" ? currentValue : ""}
          min={0}
          step={100}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n >= 0) onCommit(n);
          }}
        />
      );
    }
    case "select":
    case "enum": {
      const options =
        (entry.enum_values as string[] | undefined) ??
        (entry.options as string[] | undefined) ??
        [];
      return (
        <select
          style={INPUT_STYLE}
          value={typeof currentValue === "string" ? currentValue : ""}
          onChange={(e) => onCommit(e.target.value)}
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }
    case "path-ref":
    default:
      // FIXME (v2) — `path-ref` UX is deferred ; for now show a plain
      // text entry so the value is still editable.
      return (
        <input
          type="text"
          style={INPUT_STYLE}
          value={typeof currentValue === "string" ? currentValue : ""}
          onChange={(e) => onCommit(e.target.value)}
        />
      );
  }
}
