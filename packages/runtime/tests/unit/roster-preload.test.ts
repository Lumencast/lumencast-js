// Roster preload (lumencast-js #87b / Prism #230).
//
// Two proofs:
//   A. Transport — a `scene_roster` frame is dispatched to `onSceneRoster` and
//      is OUT-OF-BAND w.r.t. the sequence tracker: a following delta with the
//      next expected seq still applies (no VERSION_GAP fault).
//   B. Warm — mount() warms every roster entry's render bundle in the
//      background so the FIRST switch to that scene is a cache hit, not a
//      blocking fetch. Covers both the `scene_roster` frame path and the
//      public `preloadRoster` mount option.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  delta,
  encodeFrame,
  sceneChanged,
  sceneRoster,
  snapshot,
  type DeltaFrame,
  type SceneRosterFrame,
} from "@lumencast/protocol";
import { WsClient } from "../../src/transport/ws.js";
import { mount } from "../../src/index.js";

// --- controllable fake WebSocket -------------------------------------------

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  url: string;
  protocol = "lsdp.v1.1";
  readyState = FakeWebSocket.CONNECTING;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  sent: string[] = [];

  constructor(url: string, _protocols?: string | string[]) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code: 1000, reason: "client closing" });
  }

  // test drivers
  fireOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
  }
  deliver(frame: unknown): void {
    this.onmessage?.({ data: encodeFrame(frame as never) });
  }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function nextInstance(): Promise<FakeWebSocket> {
  // openSocket() awaits token resolution before constructing the socket.
  for (let i = 0; i < 10 && FakeWebSocket.instances.length === 0; i++) await tick();
  const inst = FakeWebSocket.instances.at(-1);
  if (!inst) throw new Error("no FakeWebSocket was constructed");
  return inst;
}

beforeEach(() => {
  FakeWebSocket.instances = [];
});

// --- A. transport: roster is out-of-band w.r.t. the sequence tracker --------

describe("WsClient — scene_roster dispatch (transport)", () => {
  it("forwards the roster and does NOT advance/fault the sequence tracker", async () => {
    const roster: SceneRosterFrame[] = [];
    const deltas: DeltaFrame[] = [];
    const transportErrors: unknown[] = [];

    const client = new WsClient({
      url: "wss://host/lsdp/v1",
      token: "tkn",
      webSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      onSnapshot: () => {},
      onDelta: (f) => deltas.push(f),
      onSceneRoster: (f) => roster.push(f),
      onTransportError: (e) => transportErrors.push(e),
    });
    client.start();
    const sock = await nextInstance();
    sock.fireOpen();

    // Baseline the tracker at seq=1.
    sock.deliver(snapshot({ seq: 1, scene_id: "A", scene_version: "sha256:vA", state: {} }));
    // Roster arrives BETWEEN snapshot and the next delta.
    sock.deliver(
      sceneRoster({
        entries: [
          { scene_id: "A", scene_version: "sha256:vA" },
          { scene_id: "B", scene_version: "sha256:vB" },
        ],
      }),
    );
    // The next delta carries the expected seq=2. If the roster frame had
    // advanced the tracker, this would fault as a VERSION_GAP.
    sock.deliver(delta({ seq: 2, patches: [{ path: "show.title", value: "hi" }] }));

    expect(roster).toHaveLength(1);
    expect(roster[0]?.entries).toEqual([
      { scene_id: "A", scene_version: "sha256:vA" },
      { scene_id: "B", scene_version: "sha256:vB" },
    ]);
    expect(deltas).toHaveLength(1);
    expect(transportErrors).toHaveLength(0);

    client.close();
  });
});

// --- B. warm: mount() preloads roster bundles → switch is a cache hit -------

interface MetricLike {
  name: string;
  [k: string]: unknown;
}

describe("mount — roster preload warms the bundle cache", () => {
  let target: HTMLDivElement;
  let realWs: typeof WebSocket;
  let realFetch: typeof fetch;
  let fetchCalls: string[];

  const versionFromUrl = (u: string): string => u.split("/").pop() ?? "";

  beforeEach(() => {
    target = document.createElement("div");
    document.body.appendChild(target);
    fetchCalls = [];
    realWs = globalThis.WebSocket;
    realFetch = globalThis.fetch;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);
      const sceneVersion = versionFromUrl(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve({ scene_version: sceneVersion, root: { kind: "frame" } }),
      } as Response);
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.WebSocket = realWs;
    globalThis.fetch = realFetch;
    target.remove();
  });

  const bundleUrl = (id: string, v: string): string => `https://host/bundle/${id}/${v}`;
  const countFetches = (v: string): number =>
    fetchCalls.filter((u) => versionFromUrl(u) === v).length;

  it("warms roster entries, then a switch to a warmed scene fetches nothing new", async () => {
    const metrics: MetricLike[] = [];
    const handle = mount({
      target,
      serverUrl: "wss://host/lsdp/v1",
      token: "tkn",
      mode: "broadcast",
      resolveBundleUrl: bundleUrl,
      onMetric: (m) => metrics.push(m as MetricLike),
    });

    const sock = await nextInstance();
    sock.fireOpen();

    // Active scene A: its snapshot drives the on-demand bundle fetch.
    sock.deliver(snapshot({ seq: 1, scene_id: "A", scene_version: "sha256:vA", state: {} }));
    await tick();

    // Server advertises the full roster. B and C get warmed in the background.
    sock.deliver(
      sceneRoster({
        entries: [
          { scene_id: "A", scene_version: "sha256:vA" },
          { scene_id: "B", scene_version: "sha256:vB" },
          { scene_id: "C", scene_version: "sha256:vC" },
        ],
      }),
    );
    await tick();
    await tick();

    // B and C were fetched by the warmer and reported as preloaded.
    expect(countFetches("sha256:vB")).toBe(1);
    expect(countFetches("sha256:vC")).toBe(1);
    const preloaded = metrics.filter((m) => m.name === "roster_preloaded");
    expect(preloaded.map((m) => m.scene_version).sort()).toEqual(["sha256:vB", "sha256:vC"]);

    // Operator switches to B → scene_changed + fresh snapshot. The bundle is
    // already warm, so NO new fetch fires for vB.
    const beforeSwitch = countFetches("sha256:vB");
    sock.deliver(sceneChanged({ seq: 2, scene_id: "B", scene_version: "sha256:vB" }));
    sock.deliver(snapshot({ seq: 1, scene_id: "B", scene_version: "sha256:vB", state: {} }));
    await tick();
    expect(countFetches("sha256:vB")).toBe(beforeSwitch); // cache hit, no refetch

    handle.disconnect();
  });

  it("preloadRoster mount option warms bundles right after mount", async () => {
    const metrics: MetricLike[] = [];
    const handle = mount({
      target,
      serverUrl: "wss://host/lsdp/v1",
      token: "tkn",
      mode: "broadcast",
      resolveBundleUrl: bundleUrl,
      preloadRoster: [
        { scene_id: "X", scene_version: "sha256:vX" },
        { scene_id: "Y", scene_version: "sha256:vY" },
      ],
      onMetric: (m) => metrics.push(m as MetricLike),
    });

    // No snapshot needed — the option warms independently of the WS stream.
    await tick();
    await tick();

    expect(countFetches("sha256:vX")).toBe(1);
    expect(countFetches("sha256:vY")).toBe(1);

    handle.disconnect();
  });
});
