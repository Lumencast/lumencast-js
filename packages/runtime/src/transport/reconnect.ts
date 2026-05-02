// Exponential backoff schedule for the WS reconnect loop.
//
// Aggressive at first (200 ms, 400 ms, 800 ms…) then capped at 5 s so a
// sustained outage doesn't hammer the gateway. Jittered to avoid thundering
// herds when several Lumencast instances reconnect together (e.g. a CEF
// host + a webview waking from suspend at the same time).
//
// The reference schedule in LSDP/1 §7 is "0 ms, 500 ms, 1 s, 2 s, 4 s, 8 s,
// 15 s, 30 s, 60 s cap". This implementation defaults are tighter; both are
// MAY-bounded by the spec.

export interface ReconnectScheduleOptions {
  /** First delay in milliseconds. */
  initial?: number;
  /** Maximum delay in milliseconds. */
  max?: number;
  /** Multiplicative factor between attempts (>= 1). */
  factor?: number;
  /** Jitter as a fraction of the delay (0 disables, 0.2 = ±20 %). */
  jitter?: number;
  /** Random source — only injected for tests. */
  random?: () => number;
}

const DEFAULTS: Required<Omit<ReconnectScheduleOptions, "random">> = {
  initial: 200,
  max: 5_000,
  factor: 2,
  jitter: 0.2,
};

export interface ReconnectSchedule {
  /** Returns the delay to wait before the n-th attempt (1-indexed). */
  delayFor(attempt: number): number;
  /** Reset to attempt 1 (called on a successful connection). */
  reset(): void;
  /** Current attempt counter. */
  readonly attempt: number;
}

class ScheduleImpl implements ReconnectSchedule {
  private _attempt = 0;
  constructor(
    private readonly opts: Required<Omit<ReconnectScheduleOptions, "random">>,
    private readonly random: () => number,
  ) {}

  get attempt(): number {
    return this._attempt;
  }

  delayFor(attempt: number): number {
    if (!Number.isInteger(attempt) || attempt < 1) {
      throw new RangeError(`attempt must be a positive integer, got ${attempt}`);
    }
    this._attempt = attempt;
    const base = Math.min(
      this.opts.initial * Math.pow(this.opts.factor, attempt - 1),
      this.opts.max,
    );
    if (this.opts.jitter <= 0) return base;
    const offset = (this.random() * 2 - 1) * this.opts.jitter * base;
    return Math.max(0, base + offset);
  }

  reset(): void {
    this._attempt = 0;
  }
}

export function createReconnectSchedule(opts: ReconnectScheduleOptions = {}): ReconnectSchedule {
  const merged = {
    initial: opts.initial ?? DEFAULTS.initial,
    max: opts.max ?? DEFAULTS.max,
    factor: opts.factor ?? DEFAULTS.factor,
    jitter: opts.jitter ?? DEFAULTS.jitter,
  };
  if (merged.initial <= 0) throw new RangeError("initial must be > 0");
  if (merged.max < merged.initial) throw new RangeError("max must be >= initial");
  if (merged.factor < 1) throw new RangeError("factor must be >= 1");
  if (merged.jitter < 0 || merged.jitter > 1) throw new RangeError("jitter must be within [0, 1]");
  return new ScheduleImpl(merged, opts.random ?? Math.random);
}
