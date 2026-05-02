// Monotonic sequence tracker with gap detection.
// LSDP/1 §5: server frames carry strictly monotonic seq starting at 1
// per subscription; resets to 1 after scene_changed.
//
// Receiver rules:
//   - seq > last + 1 → gap, runtime MUST close + reconnect
//   - seq <= last    → replay, runtime MUST drop silently
//   - seq == last+1  → in-order, accept

export type SequenceObservation =
  | { kind: "in-order"; seq: number }
  | { kind: "duplicate"; seq: number; lastSeq: number }
  | { kind: "gap"; seq: number; lastSeq: number };

export class SequenceTracker {
  private lastSeq = 0;

  /** Observe an incoming server seq. Returns the classification. */
  observe(seq: number): SequenceObservation {
    if (!Number.isInteger(seq) || seq < 1) {
      // Treat malformed seq as a gap so the runtime reconnects.
      return { kind: "gap", seq, lastSeq: this.lastSeq };
    }
    if (seq <= this.lastSeq) {
      return { kind: "duplicate", seq, lastSeq: this.lastSeq };
    }
    if (seq > this.lastSeq + 1) {
      return { kind: "gap", seq, lastSeq: this.lastSeq };
    }
    this.lastSeq = seq;
    return { kind: "in-order", seq };
  }

  /** Reset the tracker. Called after `scene_changed` and on reconnect. */
  reset(): void {
    this.lastSeq = 0;
  }

  get last(): number {
    return this.lastSeq;
  }
}
