// Conformance harness — drives a server through a YAML scenario via the
// LSDP/1 wire protocol + the HTTP test control plane.
//
// One harness per run; each scenario is fully isolated:
//   1. Hash inline bundles
//   2. POST /test/setup with tokens + bundles + initial_state
//   3. Open WebSocket to the URL returned by setup (subprotocol lsdp.v1)
//   4. Walk steps, sending/expecting frames + control-plane introspection
//   5. POST /test/reset before the next scenario

import { WebSocket } from "ws";
import { WS_SUBPROTOCOL } from "../types.js";
import { hashInlineBundle } from "./bundle-hash.js";
import { ControlClient } from "./control-client.js";
import { matchFrame } from "./match.js";
import { substitute } from "./placeholders.js";
import type { BundleDecl, ClientAction, Scenario, Step, Tag, Target } from "./scenario.js";

export interface HarnessOptions {
  /** ws://host:port/lsdp/v1 — the WS endpoint the server returns from /test/setup,
   *  OR (for servers that don't speak the control plane) the static endpoint. */
  serverUrl?: string;
  /** http://host:port — the test control plane root. Required for cross-language. */
  controlUrl: string;
  /** Token map used by /test/setup. Must include the canonical placeholders.
   *  Default: the canonical interop tokens (matches lumencast-protocol/interop/fixtures/). */
  tokens?: Record<string, string>;
  /** Per-step read timeout. Default 2_000 ms. */
  stepTimeoutMs?: number;
}

const DEFAULT_TOKENS: Record<string, string> = {
  $TOKEN_OPERATOR: "interop-tok-operator-7f3a",
  $TOKEN_VIEWER: "interop-tok-viewer-7f3a",
  $TOKEN_SERVICE: "interop-tok-service-7f3a",
  $TOKEN_TEST: "interop-tok-test-7f3a",
  $TOKEN_INVALID: "interop-tok-invalid-7f3a",
};

export type Outcome = "PASS" | "FAIL" | "SKIP";

export interface ScenarioResult {
  name: string;
  tag: Tag;
  target: Target;
  outcome: Outcome;
  reason?: string;
}

export interface Report {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  results: ScenarioResult[];
}

export class Harness {
  private readonly control: ControlClient;
  private readonly tokens: Record<string, string>;
  private readonly stepTimeoutMs: number;

  constructor(private readonly opts: HarnessOptions) {
    this.control = new ControlClient(opts.controlUrl);
    this.tokens = opts.tokens ?? DEFAULT_TOKENS;
    this.stepTimeoutMs = opts.stepTimeoutMs ?? 2000;
  }

  /** Run a single scenario. */
  async runScenario(scenario: Scenario): Promise<ScenarioResult> {
    const base = { name: scenario.name, tag: scenario.tag, target: scenario.target };

    // Skip runtime-targeted scenarios — this harness drives a server.
    if (scenario.target === "runtime") {
      return {
        ...base,
        outcome: "SKIP",
        reason: "runtime-targeted scenario, harness drives a server",
      };
    }

    let bundleHashes: Record<string, string> = {};
    if (scenario.bundles && scenario.bundles.length > 0) {
      bundleHashes = await this.computeBundleHashes(scenario.bundles);
    }

    // Build the /test/setup payload. The control plane requires at least one
    // bundle; if the scenario doesn't declare any, infer scene_id +
    // scene_version + initial state from the first server-sends snapshot step.
    const setupBundles = buildSetupBundles(scenario, bundleHashes);
    const initialState = setupBundles.initialState;

    let setupResponse;
    try {
      setupResponse = await this.control.setup({
        scenario: scenario.name,
        tokens: this.tokens,
        bundles: setupBundles.bundles,
        initial_state: initialState,
      });
    } catch (err) {
      return { ...base, outcome: "FAIL", reason: `setup: ${(err as Error).message}` };
    }
    void setupResponse;

    const wsUrl = this.opts.serverUrl ?? setupResponse.ws_url;
    let ws: WebSocket;
    try {
      ws = await openSocket(wsUrl);
    } catch (err) {
      await this.control.reset().catch(() => undefined);
      return { ...base, outcome: "FAIL", reason: `dial: ${(err as Error).message}` };
    }

    const exec = new Exec(ws, this.tokens, bundleHashes, this.control, this.stepTimeoutMs);
    let result: ScenarioResult = { ...base, outcome: "PASS" };
    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i]!;
      try {
        await exec.runStep(step);
      } catch (err) {
        result = {
          ...base,
          outcome: "FAIL",
          reason: `step ${i + 1} (${step.kind}): ${(err as Error).message}`,
        };
        break;
      }
    }

    try {
      ws.close(1000, "scenario done");
    } catch {
      // ignore
    }
    await this.control.reset().catch(() => undefined);

    return result;
  }

  /** Run every scenario in `scenarios` matching the tag filter (default required). */
  async runAll(scenarios: Scenario[], tagFilter: Tag = "required"): Promise<Report> {
    const rep: Report = { total: 0, passed: 0, failed: 0, skipped: 0, results: [] };
    for (const sc of scenarios) {
      rep.total++;
      if (sc.tag !== tagFilter) {
        rep.skipped++;
        rep.results.push({
          name: sc.name,
          tag: sc.tag,
          target: sc.target,
          outcome: "SKIP",
          reason: `tag ${sc.tag} != filter ${tagFilter}`,
        });
        continue;
      }
      const r = await this.runScenario(sc);
      rep.results.push(r);
      if (r.outcome === "PASS") rep.passed++;
      else if (r.outcome === "FAIL") rep.failed++;
      else rep.skipped++;
    }
    return rep;
  }

  private async computeBundleHashes(bundles: BundleDecl[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const b of bundles) {
      const h = await hashInlineBundle(b.inline);
      b.hash = h;
      out[b.id] = h;
    }
    return out;
  }
}

class Exec {
  private shadowState: Record<string, unknown> = {};
  private readonly inbox: string[] = [];
  private readonly waiters: Array<(v: string) => void> = [];
  private closed = false;
  /** WebSocket close code (RFC 6455). Set on the `close` event ; used
   * by `expect-no-frame-for` to distinguish clean shutdown (1000/1001/
   * 1005) from abnormal closures. */
  private closeCode: number | null = null;

  constructor(
    private readonly ws: WebSocket,
    private readonly tokens: Record<string, string>,
    private readonly bundleHashes: Record<string, string>,
    private readonly control: ControlClient,
    private readonly stepTimeoutMs: number,
  ) {
    // Queue messages so frames that arrive between recv() calls aren't lost.
    this.ws.on("message", (data) => {
      const s = String(data);
      const w = this.waiters.shift();
      if (w) w(s);
      else this.inbox.push(s);
    });
    this.ws.on("close", (code: number) => {
      this.closed = true;
      this.closeCode = code;
      // Wake every waiter so they reject promptly.
      while (this.waiters.length > 0) this.waiters.shift()!(""); // signal close
    });
  }

  async runStep(step: Step): Promise<void> {
    switch (step.kind) {
      case "client-sends":
        return this.send(step.frame ?? {});
      case "server-sends":
        return this.expectServerFrame(step.frame ?? {});
      case "server-emits":
        return this.serverEmits(step.frame ?? {});
      case "expect-runtime-state":
        return this.expectRuntimeState(step.state ?? {});
      case "expect-server-state":
        return this.expectServerState(step.state ?? {});
      case "expect-no-frame-for":
        return this.expectQuiet(step.duration_ms ?? 0);
      case "expect-client-action":
        return this.expectClientAction(step.action, step.reason);
      default:
        throw new Error(`unsupported step kind ${(step as { kind: string }).kind}`);
    }
  }

  /**
   * `server-emits` (SCENARIO-FORMAT.md) — harness orchestrates a
   * server-driven frame via the test control plane, then validates
   * the wire form. Only `frame.type === "delta"` is currently
   * supported (POST /test/emit).
   */
  private async serverEmits(expected: Record<string, unknown>): Promise<void> {
    if (expected["type"] !== "delta" || !Array.isArray(expected["patches"])) {
      throw new Error(
        `server-emits only supports type=delta today, got ${String(expected["type"])}`,
      );
    }
    const patches = expected["patches"] as Array<{ path: string; value: unknown }>;
    const resolved = patches.map((p) => ({
      path: p.path,
      value: substitute(p.value, this.tokens, this.bundleHashes),
    }));
    await this.control.emit(resolved);
    return this.expectServerFrame(expected);
  }

  private send(frame: Record<string, unknown>): Promise<void> {
    const resolved = substitute(frame, this.tokens, this.bundleHashes);
    return new Promise<void>((resolve, reject) => {
      this.ws.send(JSON.stringify(resolved), (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async expectServerFrame(expected: Record<string, unknown>): Promise<void> {
    // Try to read what's already in flight first (snapshots, error frames, and
    // operator-input echoes arrive without prompting). Only fall back to
    // /test/emit when nothing arrives within a short window AND the expected
    // frame is a delta — that's the case where the server needs nudging.
    const want = substitute(expected, this.tokens, this.bundleHashes) as Record<string, unknown>;

    let actual: Record<string, unknown> | null = null;
    try {
      const raw = await this.recv(150);
      actual = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // No frame yet — if the expected is a delta, drive it via /test/emit.
      if (expected["type"] === "delta" && Array.isArray(expected["patches"])) {
        const patches = expected["patches"] as Array<{ path: string; value: unknown }>;
        const resolved = patches.map((p) => ({
          path: p.path,
          value: substitute(p.value, this.tokens, this.bundleHashes),
        }));
        try {
          await this.control.emit(resolved);
        } catch {
          // Swallow — the matcher will report any actual mismatch.
        }
      }
      const raw = await this.recv(this.stepTimeoutMs);
      actual = JSON.parse(raw) as Record<string, unknown>;
    }

    const err = matchFrame(want, actual);
    if (err) {
      throw new Error(
        `frame mismatch at ${err.path}: ${err.reason} (got ${JSON.stringify(actual)})`,
      );
    }
    this.absorb(actual);
  }

  private absorb(frame: Record<string, unknown>): void {
    if (frame["type"] === "snapshot") {
      const state = (frame["state"] as Record<string, unknown>) ?? {};
      this.shadowState = { ...state };
    } else if (frame["type"] === "delta") {
      const patches = (frame["patches"] as Array<{ path: string; value: unknown }>) ?? [];
      for (const p of patches) this.shadowState[p.path] = p.value;
    }
  }

  private expectRuntimeState(want: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(want)) {
      if (!(k in this.shadowState)) {
        throw new Error(`runtime state missing ${k}`);
      }
      const got = this.shadowState[k];
      if (JSON.stringify(got) !== JSON.stringify(v)) {
        throw new Error(
          `runtime state ${k}: want ${JSON.stringify(v)}, got ${JSON.stringify(got)}`,
        );
      }
    }
  }

  private async expectServerState(want: Record<string, unknown>): Promise<void> {
    const snap = await this.control.state();
    for (const [k, v] of Object.entries(want)) {
      if (!(k in snap.state)) {
        throw new Error(`server state missing ${k}`);
      }
      const got = snap.state[k];
      if (JSON.stringify(got) !== JSON.stringify(v)) {
        throw new Error(`server state ${k}: want ${JSON.stringify(v)}, got ${JSON.stringify(got)}`);
      }
    }
  }

  private async expectQuiet(durationMs: number): Promise<void> {
    try {
      const raw = await this.recv(durationMs);
      throw new Error(`expected silence for ${durationMs}ms, got frame: ${raw}`);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "recv timeout") return;
      // SCENARIO-FORMAT.md `expect-no-frame-for` § Connection-close
      // semantics : clean WS close (1000/1001/1005) within the duration
      // counts as success — no data flowed. Abnormal closures still
      // surface as errors.
      if (msg === "connection closed") {
        const code = this.closeCode;
        if (code === 1000 || code === 1001 || code === 1005) return;
      }
      throw err;
    }
  }

  private async expectClientAction(
    action: ClientAction | undefined,
    _reason: string | undefined,
  ): Promise<void> {
    if (!action) throw new Error("expect-client-action: action required");
    if (action === "close-with-reason" || action === "reconnect") {
      // Read should reject (connection closed or no further frames).
      try {
        await this.recv(this.stepTimeoutMs);
      } catch (err) {
        if ((err as Error).message === "recv timeout") return;
        // close → recv rejects, that's the success path.
        return;
      }
      throw new Error(`expected connection close or no frame, got data`);
    }
    throw new Error(`unknown client action ${action}`);
  }

  private recv(timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const queued = this.inbox.shift();
      if (queued !== undefined) {
        resolve(queued);
        return;
      }
      if (this.closed) {
        reject(new Error("connection closed"));
        return;
      }
      const t = setTimeout(() => {
        const i = this.waiters.indexOf(resolveAndDispatch);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error("recv timeout"));
      }, timeoutMs);
      const resolveAndDispatch = (v: string): void => {
        clearTimeout(t);
        if (v === "" && this.closed) reject(new Error("connection closed"));
        else resolve(v);
      };
      this.waiters.push(resolveAndDispatch);
    });
  }
}

function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, [WS_SUBPROTOCOL]);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function extractInitialState(bundles: BundleDecl[]): Record<string, unknown> {
  // The Go reference reads `initial_state` from the scenario top-level when
  // present. Our scenarios encode it inside each bundle's `defaults` field
  // (LSML 1.0 §10). Pull from the first bundle's defaults if any.
  const primary = bundles[0];
  if (primary && typeof primary.inline === "object" && primary.inline !== null) {
    const defaults = (primary.inline as { defaults?: Record<string, unknown> }).defaults;
    if (defaults && typeof defaults === "object") return defaults;
  }
  return {};
}

interface ResolvedSetupBundles {
  bundles: Array<{ id: string; hash: string; inline: unknown }>;
  initialState: Record<string, unknown>;
}

/** Build the bundles + initial_state payload for /test/setup.
 *  When the scenario declares bundles, use them verbatim. Otherwise, infer
 *  scene_id + scene_version + initial state from the first server-sends
 *  snapshot step in the scenario — the same shape the harness will later
 *  expect on the wire. */
function buildSetupBundles(
  scenario: Scenario,
  bundleHashes: Record<string, string>,
): ResolvedSetupBundles {
  if (scenario.bundles && scenario.bundles.length > 0) {
    return {
      bundles: scenario.bundles.map((b) => ({
        id: b.id,
        hash: bundleHashes[b.id] ?? "",
        inline: b.inline,
      })),
      initialState: extractInitialState(scenario.bundles),
    };
  }

  // Look for the first `server-sends snapshot` step.
  let sceneId = "t";
  let sceneVersion = "sha256:" + "f".repeat(64);
  let initialState: Record<string, unknown> = {};
  for (const step of scenario.steps) {
    if (step.kind !== "server-sends" || !step.frame || step.frame["type"] !== "snapshot") {
      continue;
    }
    const snap = step.frame;
    if (typeof snap["scene_id"] === "string" && snap["scene_id"] !== "$ANY") {
      sceneId = snap["scene_id"];
    }
    if (typeof snap["scene_version"] === "string" && snap["scene_version"] !== "$ANY_HASH") {
      sceneVersion = snap["scene_version"];
    }
    if (snap["state"] && typeof snap["state"] === "object") {
      initialState = snap["state"] as Record<string, unknown>;
    }
    break;
  }

  // Synthesize an `operator_inputs` schema declaring every __inputs.* path
  // present in the initial state. This makes the server reject UNKNOWN_PATH
  // for inputs on undeclared paths, mirroring real-server semantics.
  const operatorInputs = Object.keys(initialState)
    .filter((p) => p.startsWith("__inputs."))
    .map((p) => ({
      path: p,
      label: p,
      type: typeof initialState[p] === "number" ? "number" : "string",
      writable_by: ["operator"],
    }));

  return {
    bundles: [
      {
        id: sceneId,
        hash: sceneVersion,
        inline: {
          scene_id: sceneId,
          synthetic: true,
          ...(operatorInputs.length > 0 ? { operator_inputs: operatorInputs } : {}),
        },
      },
    ],
    initialState,
  };
}
