import { useSignals } from "@preact/signals-react/runtime";
import { useState } from "react";
import { useLumencastRuntime } from "./runtime-context";

const PANEL_STYLE: React.CSSProperties = {
  position: "fixed",
  bottom: 12,
  right: 12,
  zIndex: 100_001,
  width: 360,
  maxHeight: "70vh",
  overflowY: "auto",
  padding: 12,
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  fontSize: 12,
  color: "#e5e7eb",
  background: "rgba(8, 47, 73, 0.92)",
  border: "1px solid rgba(56, 189, 248, 0.4)",
  borderRadius: 10,
  boxShadow: "0 8px 32px rgba(0, 0, 0, 0.45)",
};

const SECTION_TITLE: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 11,
  letterSpacing: "0.06em",
  color: "#7dd3fc",
  textTransform: "uppercase",
  marginBottom: 6,
};

const BUTTON_STYLE: React.CSSProperties = {
  background: "rgba(14, 165, 233, 0.4)",
  border: "1px solid rgba(125, 211, 252, 0.5)",
  borderRadius: 6,
  color: "#f0f9ff",
  padding: "3px 8px",
  fontSize: 11,
  cursor: "pointer",
};

const ADAPTER_ROW: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: "6px 0",
  borderBottom: "1px solid rgba(56, 189, 248, 0.2)",
};

/** Test-mode overlay : adapter mocker + state inspector + time
 *  controls. Drives the server's __test.* family via the same `sendInput`
 *  channel. */
export function TestPanel() {
  const { bundle, store, sendInput } = useLumencastRuntime();
  useSignals();
  const [filter, setFilter] = useState("");

  const adapters = bundle.external_adapters ?? [];
  const stateRecord = store.toRecord();
  const filteredEntries = Object.entries(stateRecord).filter(
    ([k]) => filter === "" || k.includes(filter),
  );

  return (
    <div style={PANEL_STYLE} data-testid="lumencast-test-panel">
      {/* Time controls */}
      <div style={SECTION_TITLE}>Time</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <button
          type="button"
          style={BUTTON_STYLE}
          onClick={() => sendInput([{ path: "__test.tick", value: 100 }])}
        >
          tick +100ms
        </button>
        <button
          type="button"
          style={BUTTON_STYLE}
          onClick={() => sendInput([{ path: "__test.tick", value: 1_000 }])}
        >
          tick +1s
        </button>
        <button
          type="button"
          style={BUTTON_STYLE}
          onClick={() => sendInput([{ path: "__test.reset", value: true }])}
        >
          reset
        </button>
      </div>

      {/* Adapter mocker */}
      <div style={SECTION_TITLE}>External adapters</div>
      {adapters.length === 0 && (
        <div style={{ color: "#94a3b8", fontStyle: "italic", fontSize: 11 }}>
          No external adapters declared in this scene.
        </div>
      )}
      {adapters.map((adapter) => (
        <AdapterRow
          key={adapter.key}
          adapter={adapter}
          onMock={(payload) =>
            // LSDP/1 patch values must be leaf — JSON-encode the structured payload.
            sendInput([
              {
                path: "__test.mock_adapter",
                value: JSON.stringify({ key: adapter.key, payload }),
              },
            ])
          }
        />
      ))}

      {/* State inspector */}
      <div style={{ ...SECTION_TITLE, marginTop: 12 }}>State</div>
      <input
        type="text"
        placeholder="filter paths…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{
          background: "rgba(8, 47, 73, 0.6)",
          border: "1px solid rgba(125, 211, 252, 0.4)",
          borderRadius: 6,
          color: "#e0f2fe",
          padding: "4px 6px",
          fontSize: 11,
          width: "100%",
          marginBottom: 6,
        }}
      />
      <div style={{ fontFamily: "monospace", fontSize: 10.5 }}>
        {filteredEntries.map(([path, value]) => (
          <div
            key={path}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 8,
              padding: "2px 0",
              borderBottom: "1px dashed rgba(125, 211, 252, 0.15)",
            }}
          >
            <span style={{ color: "#bae6fd" }}>{path}</span>
            <span style={{ color: "#fef3c7" }}>{formatValue(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdapterRow({
  adapter,
  onMock,
}: {
  adapter: { key: string; label: string; kind: string };
  onMock: (payload: unknown) => void;
}) {
  const [draft, setDraft] = useState("{}");
  return (
    <div style={ADAPTER_ROW}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ color: "#e0f2fe" }}>{adapter.label}</span>
        <span style={{ color: "#94a3b8", fontSize: 10 }}>{adapter.kind}</span>
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        style={{
          fontFamily: "monospace",
          fontSize: 10.5,
          background: "rgba(8, 47, 73, 0.6)",
          color: "#e0f2fe",
          border: "1px solid rgba(125, 211, 252, 0.3)",
          borderRadius: 4,
          padding: 4,
          resize: "vertical",
        }}
      />
      <button
        type="button"
        style={BUTTON_STYLE}
        onClick={() => {
          try {
            const parsed = JSON.parse(draft);
            onMock(parsed);
          } catch {
            onMock(draft);
          }
        }}
      >
        fire
      </button>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
