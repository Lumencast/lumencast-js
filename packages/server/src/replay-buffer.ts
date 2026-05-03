// Per-scene replay buffer (LSDP/1.1 §18.1).
// Bounded ring of recent (seq, patches, cause) emissions so a 1.1
// client reconnecting with `since_sequence` can resume without a fresh
// snapshot.

import type { Cause, Patch } from "@lumencast/protocol";

export interface ReplayRecord {
  readonly seq: number;
  readonly patches: Patch[];
  readonly cause?: Cause;
}

/** Default capacity (LSDP/1.1 §18.1 SHOULD ≥ 256). */
export const DEFAULT_REPLAY_BUFFER_SIZE = 256;

export class ReplayBuffer {
  private readonly cap: number;
  private readonly records: (ReplayRecord | undefined)[];
  private head = 0;
  private size = 0;

  constructor(capacity = DEFAULT_REPLAY_BUFFER_SIZE) {
    this.cap = capacity > 0 ? capacity : DEFAULT_REPLAY_BUFFER_SIZE;
    this.records = new Array<ReplayRecord | undefined>(this.cap);
  }

  /** Record one emission. Caller is responsible for monotonic seq. */
  push(record: ReplayRecord): void {
    this.records[this.head] = record;
    this.head = (this.head + 1) % this.cap;
    if (this.size < this.cap) this.size++;
  }

  /**
   * Return every record with seq > sinceSeq, in monotonic order.
   *
   * The boolean is `false` when sinceSeq is older than the buffer's
   * earliest retained entry — the caller MUST then fall back to a
   * fresh snapshot per LSDP/1.1 §18.1.
   */
  since(sinceSeq: number): { records: ReplayRecord[]; covered: boolean } {
    if (this.size === 0) {
      // Empty buffer — caller decides whether sinceSeq matches the
      // current scene seq (caught up) or warrants a snapshot.
      return { records: [], covered: true };
    }
    const tail = (this.head - this.size + this.cap) % this.cap;
    const earliest = this.records[tail]!.seq;
    if (sinceSeq + 1 < earliest) {
      return { records: [], covered: false };
    }
    const out: ReplayRecord[] = [];
    for (let i = 0; i < this.size; i++) {
      const idx = (tail + i) % this.cap;
      const r = this.records[idx]!;
      if (r.seq > sinceSeq) out.push(r);
    }
    return { records: out, covered: true };
  }

  /** Clear the buffer. Used on scene_changed. */
  reset(): void {
    this.head = 0;
    this.size = 0;
    this.records.fill(undefined);
  }

  get length(): number {
    return this.size;
  }
}
