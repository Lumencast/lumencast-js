// ADR 006 (WebRTC mirror-compositor pivot) #3 — viewer + #3↔#4 bridge.
//
// Covered here :
//   registry — set/resolve/remove/clear + subscribe (immediate emit, change
//         emit, unsubscribe). The bridge contract #4 consumes.
//   viewer role — joins with role:"viewer", allocates RECVONLY transceivers
//         only, never calls getUserMedia, never adds a local track (no publish).
//   label mapping — a peer's stream is keyed by its STABLE join name
//         (`peer_label`), surfaced as `RemoteTrackEvent.peerName` (Conduit
//         invariant #6 : `peer_label == name == peerName`).
//   ownership/lifecycle — the viewer owns the pc + aggregated stream ; peer-left
//         closes the pc (ends tracks) and the registry drops the reference ; a
//         consumer unmounting its <video> stops NOTHING.
//   #3↔#4 end-to-end — createPeerViewer → a fake remote-track →
//         subscribePeerStream → the LIVE `media` primitive renders srcObject ;
//         peer-left → the node falls back to a stream-less box.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { Tree } from "../../src/render/tree.js";
import type { RenderNode } from "../../src/render/bundle.js";
import { createStore } from "../../src/state/store.js";
import { LumencastRuntimeProvider } from "../../src/overlay/runtime-context.js";
import { createPeerStreamRegistry } from "../../src/webrtc/peer-stream-registry.js";
import {
  MeetViewer,
  type MeetViewerDeps,
  type ServerMessage,
} from "../../src/webrtc/meet-viewer.js";
import {
  createPeerViewer,
  createMultiRoomPeerViewer,
  createPeerViewerFromInjection,
} from "../../src/webrtc/index.js";

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

describe("PeerStreamRegistry — the #3↔#4 bridge store", () => {
  function realStream(): MediaStream {
    const s = new MediaStream();
    (s as unknown as { getTracks: () => MediaStreamTrack[] }).getTracks = () => [];
    return s;
  }

  it("set/resolve/remove/clear track the current stream per label", () => {
    const r = createPeerStreamRegistry();
    expect(r.resolve("host_cam")).toBeNull();
    const a = realStream();
    r.set("host_cam", a);
    expect(r.resolve("host_cam")).toBe(a);
    r.remove("host_cam");
    expect(r.resolve("host_cam")).toBeNull();
    r.set("host_cam", a);
    r.clear();
    expect(r.resolve("host_cam")).toBeNull();
  });

  it("subscribe emits the current value immediately, then on every change", () => {
    const r = createPeerStreamRegistry();
    const seen: (MediaStream | null)[] = [];
    const a = realStream();
    r.set("game_main", a);
    const unsub = r.subscribe("game_main", (s) => seen.push(s));
    expect(seen).toEqual([a]); // immediate emit of current
    r.remove("game_main");
    expect(seen).toEqual([a, null]); // change emit
    unsub();
    r.set("game_main", a);
    expect(seen).toEqual([a, null]); // no emit after unsubscribe
  });
});

/* ------------------------------------------------------------------ */
/* MeetViewer — role + recvonly + label + ownership                    */
/* ------------------------------------------------------------------ */

/** A controllable fake WebSocket capturing sent frames and exposing the
 *  message/open hooks. */
class FakeWS {
  static OPEN = 1 as const;
  static instances: FakeWS[] = [];
  readyState = FakeWS.OPEN;
  sent: string[] = [];
  private handlers = new Map<string, Set<(e: unknown) => void>>();
  constructor(public url: string) {
    FakeWS.instances.push(this);
    // Fire open on the next microtask so `join()` resolves.
    queueMicrotask(() => this.fire("open", {}));
  }
  /** Find the WS whose URL carries `room=<roomId>` (multi-room addressing). */
  static forRoom(roomId: string): FakeWS {
    const ws = FakeWS.instances.find((w) => new URL(w.url).searchParams.get("room") === roomId);
    if (!ws) throw new Error(`no FakeWS for room ${roomId}`);
    return ws;
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    const set = this.handlers.get(type) ?? new Set();
    this.handlers.set(type, set);
    set.add(fn);
  }
  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.handlers.get(type)?.delete(fn);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.fire("close", { code: 1000, reason: "" });
  }
  fire(type: string, e: unknown): void {
    for (const fn of this.handlers.get(type) ?? []) fn(e);
  }
  deliver(msg: ServerMessage): void {
    this.fire("message", { data: JSON.stringify(msg) });
  }
}

/** A fake RTCPeerConnection recording transceiver allocations and exposing a
 *  `track` event injector + a `close` spy. */
interface FakeTransceiver {
  kind: string;
  direction: string;
  /** Codec mimeTypes passed to setCodecPreferences, or null if never called. */
  pinned: string[] | null;
  setCodecPreferences(codecs: { mimeType: string }[]): void;
}

class FakePC {
  static instances: FakePC[] = [];
  transceivers: FakeTransceiver[] = [];
  closed = false;
  connectionState: RTCPeerConnectionState = "new";
  signalingState: RTCSignalingState = "stable";
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: unknown = null;
  private handlers = new Map<string, Set<(e: unknown) => void>>();
  constructor() {
    FakePC.instances.push(this);
  }
  addTransceiver(kind: string, init: { direction: string }): FakeTransceiver {
    const tx: FakeTransceiver = {
      kind,
      direction: init.direction,
      pinned: null,
      setCodecPreferences(codecs) {
        tx.pinned = codecs.map((c) => c.mimeType);
      },
    };
    this.transceivers.push(tx);
    return tx;
  }
  txOf(kind: string): FakeTransceiver | undefined {
    return this.transceivers.find((t) => t.kind === kind);
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    const set = this.handlers.get(type) ?? new Set();
    this.handlers.set(type, set);
    set.add(fn);
  }
  close(): void {
    this.closed = true;
  }
  getStats(): Promise<RTCStatsReport> {
    return Promise.resolve(new Map() as unknown as RTCStatsReport);
  }
  fireTrack(track: MediaStreamTrack): void {
    for (const fn of this.handlers.get("track") ?? []) fn({ track });
  }
}

function fakeTrack(): MediaStreamTrack {
  const handlers = new Set<() => void>();
  return {
    kind: "video",
    stop: vi.fn(),
    addEventListener: (_t: string, fn: () => void) => handlers.add(fn),
  } as unknown as MediaStreamTrack;
}

/** happy-dom's MediaStream stub has no track methods ; supply a minimal one the
 *  viewer's aggregation (`getTracks`/`addTrack`/`removeTrack`) can drive, and
 *  that `<video>.srcObject` still accepts (it extends the real MediaStream). */
class FakeMediaStream extends MediaStream {
  private tracks: MediaStreamTrack[] = [];
  getTracks(): MediaStreamTrack[] {
    return this.tracks;
  }
  addTrack(t: MediaStreamTrack): void {
    this.tracks.push(t);
  }
  removeTrack(t: MediaStreamTrack): void {
    this.tracks = this.tracks.filter((x) => x !== t);
  }
}

function viewerDeps(): MeetViewerDeps {
  return {
    WebSocket: FakeWS as unknown as typeof WebSocket,
    RTCPeerConnection: FakePC as unknown as typeof RTCPeerConnection,
    MediaStream: FakeMediaStream as unknown as typeof MediaStream,
  };
}

const JOINED = (peers: { id: string; name: string }[]): ServerMessage => ({
  type: "joined",
  peerId: "self",
  roomId: "room1",
  role: "viewer",
  peers: peers.map((p) => ({ ...p, role: "publisher" as const })),
  turn: { urls: ["turn:turn.cyell.pro:3478"], username: "u", credential: "c", ttl: 600 },
});

describe("MeetViewer — viewer role, recvonly, no publish", () => {
  beforeEach(() => {
    FakePC.instances = [];
  });

  it("joins with role:viewer and never calls getUserMedia", async () => {
    const getUserMedia = vi.fn();
    const original = (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
    try {
      const v = new MeetViewer({
        signalingUrl: "wss://meet.cyell.pro/ws",
        roomId: "room1",
        token: "tok",
        name: "solar-return",
        deps: viewerDeps(),
      });
      await v.join();
      // The join frame announces the viewer role.
      const ws = (v as unknown as { ws: FakeWS }).ws;
      const join = JSON.parse(ws.sent[0]);
      expect(join).toMatchObject({ type: "join", role: "viewer", name: "solar-return" });
      expect(getUserMedia).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(navigator, "mediaDevices", { value: original, configurable: true });
    }
  });

  it("allocates RECVONLY audio+video transceivers per peer, no local track", async () => {
    const v = new MeetViewer({
      signalingUrl: "wss://meet.cyell.pro/ws",
      roomId: "room1",
      token: "tok",
      name: "viewer",
      deps: viewerDeps(),
    });
    await v.join();
    const ws = (v as unknown as { ws: FakeWS }).ws;
    ws.deliver(JOINED([{ id: "p1", name: "host_cam" }]));
    expect(FakePC.instances).toHaveLength(1);
    expect(
      FakePC.instances[0].transceivers.map((t) => ({ kind: t.kind, direction: t.direction })),
    ).toEqual([
      { kind: "audio", direction: "recvonly" },
      { kind: "video", direction: "recvonly" },
    ]);
  });

  it("pins a minimal BUNDLE-safe codec set (H264+rtx / opus) when capabilities exist", async () => {
    // Install a capable RTCRtpReceiver.getCapabilities returning the FULL
    // Chromium-like catalogue ; the viewer must narrow it on each transceiver.
    const original = (globalThis as { RTCRtpReceiver?: unknown }).RTCRtpReceiver;
    Object.defineProperty(globalThis, "RTCRtpReceiver", {
      value: {
        getCapabilities: (kind: string) =>
          kind === "video"
            ? {
                codecs: [
                  { mimeType: "video/VP8" },
                  { mimeType: "video/VP9" },
                  { mimeType: "video/H264" },
                  { mimeType: "video/rtx" },
                  { mimeType: "video/AV1" },
                  { mimeType: "video/H265" },
                  { mimeType: "video/red" },
                  { mimeType: "video/ulpfec" },
                ],
              }
            : {
                codecs: [
                  { mimeType: "audio/opus" },
                  { mimeType: "audio/telephone-event" },
                  { mimeType: "audio/PCMU" },
                ],
              },
      },
      configurable: true,
    });
    try {
      const v = new MeetViewer({
        signalingUrl: "wss://meet.cyell.pro/ws",
        roomId: "room1",
        token: "tok",
        name: "viewer",
        deps: viewerDeps(),
      });
      await v.join();
      const ws = (v as unknown as { ws: FakeWS }).ws;
      ws.deliver(JOINED([{ id: "p1", name: "host_cam" }]));
      const pc = FakePC.instances[0];
      // Video narrowed to H264 + rtx ONLY (drops VP8/VP9/AV1/H265/red/ulpfec).
      expect(pc.txOf("video")!.pinned).toEqual(["video/H264", "video/rtx"]);
      // Audio narrowed to opus + telephone-event (drops PCMU).
      expect(pc.txOf("audio")!.pinned).toEqual(["audio/opus", "audio/telephone-event"]);
    } finally {
      if (original === undefined) {
        delete (globalThis as { RTCRtpReceiver?: unknown }).RTCRtpReceiver;
      } else {
        Object.defineProperty(globalThis, "RTCRtpReceiver", {
          value: original,
          configurable: true,
        });
      }
    }
  });

  it("is a no-op (default full list) when getCapabilities is unavailable", async () => {
    const original = (globalThis as { RTCRtpReceiver?: unknown }).RTCRtpReceiver;
    delete (globalThis as { RTCRtpReceiver?: unknown }).RTCRtpReceiver;
    try {
      const v = new MeetViewer({
        signalingUrl: "wss://meet.cyell.pro/ws",
        roomId: "room1",
        token: "tok",
        name: "viewer",
        deps: viewerDeps(),
      });
      await v.join();
      const ws = (v as unknown as { ws: FakeWS }).ws;
      ws.deliver(JOINED([{ id: "p1", name: "host_cam" }]));
      const pc = FakePC.instances[0];
      // No capabilities → never pinned → Chromium default list preserved.
      expect(pc.txOf("video")!.pinned).toBeNull();
      expect(pc.txOf("audio")!.pinned).toBeNull();
    } finally {
      if (original !== undefined) {
        Object.defineProperty(globalThis, "RTCRtpReceiver", {
          value: original,
          configurable: true,
        });
      }
    }
  });

  it("keys a peer's stream by its STABLE join name (peer_label)", async () => {
    const v = new MeetViewer({
      signalingUrl: "wss://meet.cyell.pro/ws",
      roomId: "room1",
      token: "tok",
      name: "viewer",
      deps: viewerDeps(),
    });
    const events: { peerName: string; stream: MediaStream }[] = [];
    v.on("remote-track", (e) => events.push({ peerName: e.peerName, stream: e.stream }));
    await v.join();
    const ws = (v as unknown as { ws: FakeWS }).ws;
    ws.deliver(JOINED([{ id: "p1", name: "host_cam" }]));
    FakePC.instances[0].fireTrack(fakeTrack());
    expect(events).toHaveLength(1);
    expect(events[0].peerName).toBe("host_cam"); // label (== name), not the opaque id "p1"
  });

  it("peer-left closes the pc (ends tracks) — viewer owns the lifecycle", async () => {
    const v = new MeetViewer({
      signalingUrl: "wss://meet.cyell.pro/ws",
      roomId: "room1",
      token: "tok",
      name: "viewer",
      deps: viewerDeps(),
    });
    await v.join();
    const ws = (v as unknown as { ws: FakeWS }).ws;
    ws.deliver(JOINED([{ id: "p1", name: "host_cam" }]));
    const pc = FakePC.instances[0];
    expect(pc.closed).toBe(false);
    ws.deliver({ type: "peer-left", peerId: "p1" });
    expect(pc.closed).toBe(true); // the pc owns and ends the tracks
  });
});

/* ------------------------------------------------------------------ */
/* #3↔#4 end-to-end — viewer feeds the LIVE media primitive            */
/* ------------------------------------------------------------------ */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  FakePC.instances = [];
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderLiveNode(
  peerLabel: string,
  subscribePeerStream: (l: string, cb: (s: MediaStream | null) => void) => () => void,
): Promise<void> {
  const node: RenderNode = { kind: "media", id: "cam", props: { peerLabel, fit: "cover" } };
  const store = createStore();
  await act(async () => {
    root.render(
      <LumencastRuntimeProvider
        value={{
          mode: "broadcast",
          store,
          bundle: { root: node } as never,
          status: "live",
          sendInput: () => {},
          subscribePeerStream,
        }}
      >
        <Tree node={node} store={store} />
      </LumencastRuntimeProvider>,
    );
  });
}

describe("#3↔#4 — viewer stream → resolvePeerStream → <video srcObject>", () => {
  it("a node mounted before connect goes stream-less→srcObject on peer connect, →box on leave", async () => {
    const peerViewer = createPeerViewer({
      signalingUrl: "wss://meet.cyell.pro/ws",
      roomId: "room1",
      token: "tok",
      name: "solar",
      deps: viewerDeps(),
    });

    // The LIVE media node mounts FIRST (peer not connected yet) → stream-less box.
    await renderLiveNode("host_cam", peerViewer.subscribePeerStream);
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("[data-lumencast-media-live]")).not.toBeNull();

    // The viewer joins and the peer connects (track event) → registry.set →
    // subscriber fires → node re-renders with srcObject.
    await peerViewer.join();
    const ws = (peerViewer.viewer as unknown as { ws: FakeWS }).ws;
    ws.deliver(JOINED([{ id: "p1", name: "host_cam" }]));
    await act(async () => {
      FakePC.instances[0].fireTrack(fakeTrack());
      await Promise.resolve();
    });

    const video = container.querySelector("video") as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    expect(video!.srcObject).not.toBeNull();
    // RC-3 : the resolved stream is exactly the viewer's aggregated stream.
    expect(video!.srcObject).toBe(peerViewer.resolvePeerStream("host_cam"));

    // Peer leaves → registry.remove → subscriber fires null → back to a box,
    // and the consumer unmounting its <video> stops NOTHING (the pc owns tracks).
    await act(async () => {
      ws.deliver({ type: "peer-left", peerId: "p1" });
      await Promise.resolve();
    });
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("[data-lumencast-media-live]")).not.toBeNull();
    expect(peerViewer.resolvePeerStream("host_cam")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Multi-room — N meshes → 1 registry                                  */
/* ------------------------------------------------------------------ */

describe("createMultiRoomPeerViewer — N rooms → one aggregated registry", () => {
  beforeEach(() => {
    FakePC.instances = [];
    FakeWS.instances = [];
  });

  function room(roomId: string) {
    return { signalingUrl: "wss://meet.cyell.pro/ws", roomId, token: `tok-${roomId}` };
  }

  it("joins every room and resolves a peer_label whatever room it came from", async () => {
    const mrv = createMultiRoomPeerViewer({
      rooms: [room("roomA"), room("roomB")],
      deps: viewerDeps(),
    });
    await mrv.join();
    // Two meshes, one WS per room.
    expect(FakeWS.instances).toHaveLength(2);

    // A peer connects in room A, another in room B → both land in ONE registry.
    FakeWS.forRoom("roomA").deliver(JOINED([{ id: "a1", name: "host_cam" }]));
    FakeWS.forRoom("roomB").deliver(JOINED([{ id: "b1", name: "game_main" }]));
    FakePC.instances.find((p) => p.txOf("video"))!; // sanity: PCs exist
    // Fire a track on each peer's pc (order of creation: a1 then b1).
    const [pcA, pcB] = FakePC.instances;
    pcA.fireTrack(fakeTrack());
    pcB.fireTrack(fakeTrack());

    expect(mrv.resolvePeerStream("host_cam")).not.toBeNull();
    expect(mrv.resolvePeerStream("game_main")).not.toBeNull();
    expect(mrv.resolvePeerStream("host_cam")).not.toBe(mrv.resolvePeerStream("game_main"));
  });

  it("label collision across rooms : first-connected wins, later room ignored", async () => {
    const mrv = createMultiRoomPeerViewer({
      rooms: [room("roomA"), room("roomB")],
      deps: viewerDeps(),
    });
    await mrv.join();
    // roomA connects `dup` FIRST.
    FakeWS.forRoom("roomA").deliver(JOINED([{ id: "a1", name: "dup" }]));
    const pcA = FakePC.instances[FakePC.instances.length - 1];
    pcA.fireTrack(fakeTrack());
    const first = mrv.resolvePeerStream("dup");
    expect(first).not.toBeNull();

    // roomB connects the SAME label later → ignored, owner keeps the stream.
    FakeWS.forRoom("roomB").deliver(JOINED([{ id: "b1", name: "dup" }]));
    const pcB = FakePC.instances[FakePC.instances.length - 1];
    pcB.fireTrack(fakeTrack());
    expect(mrv.resolvePeerStream("dup")).toBe(first); // unchanged — first wins
  });

  it("setRooms reconciles : closes removed rooms, opens new ones", async () => {
    const mrv = createMultiRoomPeerViewer({ rooms: [room("roomA")], deps: viewerDeps() });
    await mrv.join();
    FakeWS.forRoom("roomA").deliver(JOINED([{ id: "a1", name: "host_cam" }]));
    FakePC.instances[FakePC.instances.length - 1].fireTrack(fakeTrack());
    expect(mrv.resolvePeerStream("host_cam")).not.toBeNull();

    // Re-arm : drop roomA, add roomB. roomA's labels are released.
    await mrv.setRooms([room("roomB")]);
    expect(mrv.resolvePeerStream("host_cam")).toBeNull(); // roomA closed → released
    // roomB is live and addressable.
    FakeWS.forRoom("roomB").deliver(JOINED([{ id: "b1", name: "game_main" }]));
    FakePC.instances[FakePC.instances.length - 1].fireTrack(fakeTrack());
    expect(mrv.resolvePeerStream("game_main")).not.toBeNull();
  });

  it("leave() tears down every room mesh and clears the registry", async () => {
    const mrv = createMultiRoomPeerViewer({
      rooms: [room("roomA"), room("roomB")],
      deps: viewerDeps(),
    });
    await mrv.join();
    FakeWS.forRoom("roomA").deliver(JOINED([{ id: "a1", name: "host_cam" }]));
    FakePC.instances[FakePC.instances.length - 1].fireTrack(fakeTrack());
    const pcs = FakePC.instances.length;
    mrv.leave();
    expect(mrv.resolvePeerStream("host_cam")).toBeNull();
    // Every pc created so far is closed.
    expect(FakePC.instances.slice(0, pcs).every((p) => p.closed)).toBe(true);
  });

  it("back-compat : createPeerViewerFromInjection accepts a single-room object", async () => {
    const mrv = createPeerViewerFromInjection({
      signalingUrl: "wss://meet.cyell.pro/ws",
      roomId: "solo",
      token: "tok",
      deps: viewerDeps(),
    });
    await mrv.join();
    expect(FakeWS.instances).toHaveLength(1);
    FakeWS.forRoom("solo").deliver(JOINED([{ id: "s1", name: "host_cam" }]));
    FakePC.instances[FakePC.instances.length - 1].fireTrack(fakeTrack());
    expect(mrv.resolvePeerStream("host_cam")).not.toBeNull();
  });

  it("back-compat : createPeerViewerFromInjection accepts the {rooms:[...]} array", async () => {
    const mrv = createPeerViewerFromInjection({
      rooms: [room("r1"), room("r2")],
      deps: viewerDeps(),
    });
    await mrv.join();
    expect(FakeWS.instances).toHaveLength(2);
  });
});
