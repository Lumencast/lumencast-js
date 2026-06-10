// Per-frame delta coalescing (ADR 001 RC#13 — bindAnimate anti-DoS).
//
// A live LSDP producer may push deltas at arbitrary frequency (the
// threat model assumes 1 kHz). Retargeting a Framer animation per delta
// would start hundreds of redundant animations per displayed frame. The
// coalescer buffers the LATEST value per binding key and flushes once
// per animation frame : one retarget max per rAF per binding,
// independently of the producer's rate.
//
// Pure scheduling logic, injectable rAF — unit-testable without a
// browser loop.

export interface FrameCoalescer {
  /** Buffer `value` for `key` ; schedules a flush on the next frame.
   *  Multiple pushes on the same key within one frame keep only the
   *  last value (the previous targets are obsolete by construction). */
  push(key: string, value: unknown): void;
  /** Cancel any scheduled flush and drop pending values. */
  dispose(): void;
}

type Schedule = (cb: () => void) => number;
type Cancel = (id: number) => void;

export function createFrameCoalescer(
  flush: (key: string, value: unknown) => void,
  schedule: Schedule = (cb) => requestAnimationFrame(cb),
  cancel: Cancel = (id) => cancelAnimationFrame(id),
): FrameCoalescer {
  const pending = new Map<string, unknown>();
  let frameId: number | null = null;
  let disposed = false;

  const onFrame = (): void => {
    frameId = null;
    // Swap-before-flush : a push() re-entrant from a flush callback
    // lands in a fresh map and schedules the NEXT frame (never the
    // current one) — the one-retarget-per-rAF bound holds.
    const entries = [...pending.entries()];
    pending.clear();
    for (const [key, value] of entries) {
      flush(key, value);
    }
  };

  return {
    push(key, value): void {
      if (disposed) return;
      pending.set(key, value);
      if (frameId === null) {
        frameId = schedule(onFrame);
      }
    },
    dispose(): void {
      disposed = true;
      pending.clear();
      if (frameId !== null) {
        cancel(frameId);
        frameId = null;
      }
    },
  };
}
