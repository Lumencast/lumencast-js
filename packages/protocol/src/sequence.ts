// Monotonic sequence tracker with gap detection.
// LSDP/1.1 §18.1.1: seq is per-scene, NOT per-subscription. The first
// frame of a fresh subscription can carry any seq >= 1 (late-joining
// subscribers see the current scene seq). The tracker rebases to the
// snapshot value after scene_changed via observeSnapshot.
//
// Receiver rules:
//   - first frame on a fresh tracker → establish baseline (any seq >= 1)
//   - seq > last + 1                 → gap, runtime MUST close + reconnect
//   - seq <= last                    → replay, runtime MUST drop silently
//   - seq == last + 1                → in-order, accept

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
    if (this.lastSeq === 0) {
      // Fresh tracker — any seq >= 1 establishes the baseline
      // (LSDP/1.1 §18.1.1).
      this.lastSeq = seq;
      return { kind: "in-order", seq };
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

  /** Rebase the tracker to a snapshot's seq. Called after scene_changed
   * or back-pressure recovery — the tracker takes the snapshot value as
   * the new baseline regardless of previous state. */
  observeSnapshot(seq: number): void {
    if (Number.isInteger(seq) && seq >= 1) {
      this.lastSeq = seq;
    }
  }

  /** Reset the tracker. Called on reconnect with no resume. */
  reset(): void {
    this.lastSeq = 0;
  }

  get last(): number {
    return this.lastSeq;
  }
}
