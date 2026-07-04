// MountOptions.transformRoot — ADR 013 (Prism), lumencast-js #95.
//
// A pure `(root: RenderNode) => RenderNode` hook applied to a fetched bundle's
// root ONCE, before its first paint. It is the injection point Solar's
// `buildAtlasRoot` (z-band splitting) needs to reshape the render tree before
// display. Three proofs:
//
//   A. Non-regression — WITHOUT `transformRoot`, mount() renders the fetched
//      bundle verbatim (the hook is purely additive; default path unchanged).
//   B. Invocation — WITH a wrapper transform that reparents the root and adds a
//      marker leaf, the hook is called with the fetched root and its RESULT is
//      what actually renders (the marker leaf appears in the DOM).
//   C. Decisive (the buildAtlasRoot case) — after a transform that reparents an
//      existing leaf under a NEW wrapper frame, a later LSDP delta targeting
//      THAT leaf by its original, unchanged path still applies: the DOM reflects
//      the delta despite the leaf's new position in the tree. The store is flat
//      and addresses leaves by path, so reparenting (no re-keying) is delta-safe.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { delta, encodeFrame, snapshot } from "@lumencast/protocol";
import { mount } from "../../src/index.js";
import type { RenderNode } from "../../src/index.js";

// --- controllable fake WebSocket (mirrors roster-preload.test.ts) -----------

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

  fireOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
  }
  deliver(frame: unknown): void {
    this.onmessage?.({ data: encodeFrame(frame as never) });
  }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Poll until `predicate` holds. The broadcast mode chunk is lazy-loaded via
 *  Suspense, so the first paint lands several async turns after the snapshot
 *  (fetch resolve → bundle signal → React re-render → lazy import → commit). */
async function waitFor(predicate: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function nextInstance(): Promise<FakeWebSocket> {
  for (let i = 0; i < 10 && FakeWebSocket.instances.length === 0; i++) await tick();
  const inst = FakeWebSocket.instances.at(-1);
  if (!inst) throw new Error("no FakeWebSocket was constructed");
  return inst;
}

// A `text` leaf bound to the state path `show.title`, wrapped in a root frame.
// The bound value renders as the text content, so both the snapshot state and
// later deltas targeting `show.title` are observable in the DOM.
const LEAF_ID = "title-leaf";
const LEAF_PATH = "show.title";
const MARKER_PATH = "show.marker";
const VERSION = "sha256:vA";

function baseBundle(): { scene_version: string; root: RenderNode } {
  return {
    scene_version: VERSION,
    root: {
      kind: "frame",
      id: "root",
      props: { width: 1920, height: 1080 },
      children: [{ kind: "text", id: LEAF_ID, bindings: { value: LEAF_PATH } }],
    },
  };
}

describe("mount — transformRoot hook (ADR 013 / #95)", () => {
  let target: HTMLDivElement;
  let realWs: typeof WebSocket;
  let realFetch: typeof fetch;

  beforeEach(async () => {
    // Warm the lazy broadcast-mode chunk so React's `lazy()` resolves without
    // adding an unbounded import delay to the first assertion (determinism).
    await import("../../src/modes/broadcast.js");
    FakeWebSocket.instances = [];
    target = document.createElement("div");
    document.body.appendChild(target);
    realWs = globalThis.WebSocket;
    realFetch = globalThis.fetch;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(baseBundle()),
      } as Response),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.WebSocket = realWs;
    globalThis.fetch = realFetch;
    target.remove();
  });

  const texts = (): string[] =>
    Array.from(target.querySelectorAll("span")).map((s) => s.textContent ?? "");

  // A. Non-regression — no hook ⇒ the fetched bundle renders verbatim.
  it("A — without transformRoot, the fetched bundle renders unchanged", async () => {
    const handle = mount({
      target,
      serverUrl: "wss://host/lsdp/v1",
      token: "tkn",
      mode: "broadcast",
    });
    const sock = await nextInstance();
    sock.fireOpen();
    sock.deliver(
      snapshot({ seq: 1, scene_id: "A", scene_version: VERSION, state: { [LEAF_PATH]: "hello" } }),
    );
    await waitFor(() => texts().length > 0);

    // Exactly the authored tree: a single leaf, its bound value, no injected node.
    expect(texts()).toEqual(["hello"]);

    handle.disconnect();
  });

  // B — the hook is invoked with the fetched root, and its result is rendered.
  it("B — a wrapper transform is invoked and its result is rendered", async () => {
    let receivedRoot: RenderNode | null = null;
    // Wrap the fetched root in a new frame and add a marker leaf bound to a
    // distinct path. The marker only renders if the TRANSFORMED tree is used.
    const transformRoot = (root: RenderNode): RenderNode => {
      receivedRoot = root;
      return {
        kind: "frame",
        id: "atlas-wrapper",
        props: { width: 1920, height: 1080 },
        children: [root, { kind: "text", id: "marker", bindings: { value: MARKER_PATH } }],
      };
    };

    const handle = mount({
      target,
      serverUrl: "wss://host/lsdp/v1",
      token: "tkn",
      mode: "broadcast",
      transformRoot,
    });
    const sock = await nextInstance();
    sock.fireOpen();
    sock.deliver(
      snapshot({
        seq: 1,
        scene_id: "A",
        scene_version: VERSION,
        state: { [LEAF_PATH]: "hello", [MARKER_PATH]: "WRAP" },
      }),
    );
    await waitFor(() => texts().length >= 2);

    // The hook saw the fetched root (the authored frame).
    expect(receivedRoot).not.toBeNull();
    expect((receivedRoot as unknown as RenderNode).id).toBe("root");
    // The transformed tree is what rendered: original leaf AND injected marker.
    expect(texts().sort()).toEqual(["WRAP", "hello"]);

    handle.disconnect();
  });

  // C — DECISIVE. Reparent a leaf under a new wrapper, then a delta targeting
  // that leaf by its ORIGINAL path still updates the DOM. This is the exact
  // delta-safety contract buildAtlasRoot exploits.
  it("C — a delta on a reparented leaf (original path) still applies", async () => {
    // Reparent the existing leaf under a brand-new wrapper frame WITHOUT
    // touching its id or its `value → show.title` binding. A marker leaf makes
    // the reparenting observable independently of the delta.
    const transformRoot = (root: RenderNode): RenderNode => {
      const leaf = root.children?.[0];
      if (!leaf) throw new Error("expected a leaf child to reparent");
      return {
        kind: "frame",
        id: "atlas-band",
        props: { width: 1920, height: 540 },
        // Leaf moved to a new position in the tree; id + binding unchanged.
        children: [leaf, { kind: "text", id: "marker", bindings: { value: MARKER_PATH } }],
      };
    };

    const handle = mount({
      target,
      serverUrl: "wss://host/lsdp/v1",
      token: "tkn",
      mode: "broadcast",
      transformRoot,
    });
    const sock = await nextInstance();
    sock.fireOpen();
    sock.deliver(
      snapshot({
        seq: 1,
        scene_id: "A",
        scene_version: VERSION,
        state: { [LEAF_PATH]: "before", [MARKER_PATH]: "BAND" },
      }),
    );
    await waitFor(() => texts().length >= 2);

    // The reparenting happened (marker present) and the leaf shows the snapshot.
    expect(texts().sort()).toEqual(["BAND", "before"]);

    // A later delta targets the leaf by its ORIGINAL, unchanged path.
    sock.deliver(delta({ seq: 2, patches: [{ path: LEAF_PATH, value: "after" }] }));
    await waitFor(() => texts().includes("after"));

    // The DOM reflects the delta despite the leaf's new position in the tree.
    expect(texts().sort()).toEqual(["BAND", "after"]);

    handle.disconnect();
  });
});
