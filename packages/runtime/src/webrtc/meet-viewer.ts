// WebRTC viewer (mesh, VIEWER role) — ADR 006 §3.3 (C1), issue #3.
//
// A viewer-only port of `Prism/src/renderer/src/lib/meet-client.ts` (§1.4) : it
// joins a Meet room, receives N peers and exposes one `MediaStream` per peer.
// It NEVER publishes : no `getUserMedia`, no local stream, every transceiver is
// `recvonly`. Recovering a WebRTC flow needs no capture permission (ADR §2),
// which is the whole point of the pivot — Solar-CEF (on-air) and the Prism
// return webview can both be viewers without a capture grant.
//
// It reuses the reference's hard-won mesh logic verbatim in spirit :
//   - perfect-negotiation (polite/impolite glare handling) ;
//   - symmetric m-line ordering (audio transceiver first, video second) ;
//   - STUN-first + per-URL TURN iceServers ;
//   - one aggregated `MediaStream` per peer (`track` → addTrack, `ended` →
//     removeTrack), handed to the consumer as `RemoteTrackEvent`.
//
// OWNERSHIP : the viewer owns each peer's `RTCPeerConnection` AND the
// `MediaStream` it aggregates. It is the SOLE authority on the track lifecycle —
// created on `track`, removed on `ended` / `peer-left` / `connectionstatechange
// failed|closed`, all torn down on `leave()`. A downstream `<video srcObject>`
// (the `media` primitive #4) is a pure consumer : unmounting it clears its own
// `srcObject` and stops nothing. A returning mirror can never kill a peer for
// the on-air composite.
//
// PEER LABEL : the transverse invariant gravé by Conduit (ZabCam contract #6) is
// a strict STRING equality — `peer_label == MeetClientOptions.name ==
// RemoteTrackEvent.peerName`, all matching `^[a-z][a-z0-9_-]{0,63}$`. Publishers
// (#5 Prism / #2 Pulsar) join with `name = peer_label` ; it comes back on the
// remote side as `PeerInfo.name`, surfaced verbatim as `RemoteTrackEvent.peerName`.
// The viewer therefore resolves `peer_label → MediaStream` by indexing peers by
// `peerName` (== label), NEVER by the opaque `peerId`. No separate label channel
// is needed : the join announce already carries it.

export type PeerRole = "publisher" | "viewer";

export interface PeerInfo {
  id: string;
  /** The peer's join name — the STABLE `peer_label` (ZabCam contract #6). */
  name: string;
  role: PeerRole;
}

export type SignalPayload =
  | { kind: "sdp"; description: { type: "offer" | "answer" | "pranswer" | "rollback"; sdp: string } }
  | {
      kind: "ice";
      candidate: {
        candidate: string;
        sdpMid: string | null;
        sdpMLineIndex: number | null;
        usernameFragment?: string | null;
      };
    }
  | { kind: "control"; event: "screen-start" | "screen-stop" | "mute" | "unmute" };

export type ClientMessage =
  | { type: "join"; name: string; role?: PeerRole }
  | { type: "signal"; to: string; payload: SignalPayload }
  | { type: "leave" };

export type ServerMessage =
  | {
      type: "joined";
      peerId: string;
      roomId: string;
      role: PeerRole;
      peers: PeerInfo[];
      turn: { urls: string[]; username: string; credential: string; ttl: number };
    }
  | { type: "peer-joined"; peer: PeerInfo }
  | { type: "peer-left"; peerId: string }
  | { type: "signal"; from: string; payload: SignalPayload }
  | { type: "error"; code: string; message: string };

export interface RemoteTrackEvent {
  peerId: string;
  /** The peer's join name == its STABLE `peer_label` (Conduit invariant #6 :
   *  `peer_label == name == peerName`, strict string equality). This is the key
   *  a `meet.peer` LSML node's `peerLabel` resolves against — never `peerId`. */
  peerName: string;
  stream: MediaStream;
}

type EventMap = {
  joined: { peerId: string; peers: PeerInfo[] };
  "peer-joined": PeerInfo;
  "peer-left": { peerId: string; peerName: string };
  "remote-track": RemoteTrackEvent;
  "connection-state": { peerId: string; state: RTCPeerConnectionState };
  error: { code: string; message: string };
  close: { code: number; reason: string };
};

type Listener<K extends keyof EventMap> = (event: EventMap[K]) => void;

interface RemoteState {
  info: PeerInfo;
  pc: RTCPeerConnection;
  stream: MediaStream;
  makingOffer: boolean;
  ignoreOffer: boolean;
  pendingCandidates: RTCIceCandidateInit[];
}

/** Minimal injectable factory for the WebSocket + RTCPeerConnection, so the
 *  viewer is testable without a real browser stack. Defaults to the globals. */
export interface MeetViewerDeps {
  WebSocket: typeof WebSocket;
  RTCPeerConnection: typeof RTCPeerConnection;
  MediaStream: typeof MediaStream;
}

export interface MeetViewerOptions {
  signalingUrl: string;
  roomId: string;
  /** Room/viewer token, sent as a query param to the signaling WS. */
  token: string;
  /** This viewer's announce name on the mesh (it does not publish a stream). */
  name: string;
  deps?: Partial<MeetViewerDeps>;
}

export class MeetViewer {
  private ws: WebSocket | null = null;
  private remotes = new Map<string, RemoteState>();
  private iceServers: RTCIceServer[] = [];
  private selfId: string | null = null;
  private listeners = new Map<keyof EventMap, Set<Listener<never>>>();
  private readonly deps: MeetViewerDeps;

  constructor(private readonly options: MeetViewerOptions) {
    this.deps = {
      WebSocket: options.deps?.WebSocket ?? globalThis.WebSocket,
      RTCPeerConnection: options.deps?.RTCPeerConnection ?? globalThis.RTCPeerConnection,
      MediaStream: options.deps?.MediaStream ?? globalThis.MediaStream,
    };
  }

  on<K extends keyof EventMap>(type: K, listener: Listener<K>): () => void {
    const set = this.listeners.get(type) ?? new Set<Listener<never>>();
    this.listeners.set(type, set);
    set.add(listener as Listener<never>);
    return () => set.delete(listener as Listener<never>);
  }

  /** Join the room as a VIEWER (recvonly). No capture, no publish. */
  join(): Promise<void> {
    return this.openSocket();
  }

  /** Leave and tear down every peer connection + aggregated stream. As the
   *  track owner, this is where the streams (and the device-side tracks) end. */
  leave(): void {
    this.send({ type: "leave" });
    this.ws?.close(1000, "viewer-leave");
  }

  /* ---- Socket ------------------------------------------------------- */

  private openSocket(): Promise<void> {
    const url = new URL(this.options.signalingUrl);
    url.searchParams.set("room", this.options.roomId);
    url.searchParams.set("token", this.options.token);

    return new Promise((resolve, reject) => {
      const ws = new this.deps.WebSocket(url.toString());
      this.ws = ws;

      const onOpen = () => {
        ws.removeEventListener("error", onError);
        // role:"viewer" — the signaling server allocates no publish slot.
        this.send({ type: "join", name: this.options.name, role: "viewer" });
        resolve();
      };
      const onError = (event: Event) => {
        ws.removeEventListener("open", onOpen);
        reject(event);
      };

      ws.addEventListener("open", onOpen, { once: true });
      ws.addEventListener("error", onError, { once: true });
      ws.addEventListener("message", (ev) => void this.onMessage((ev as MessageEvent).data));
      ws.addEventListener("close", (ev) => {
        this.tearDown();
        this.emit("close", { code: (ev as CloseEvent).code, reason: (ev as CloseEvent).reason });
      });
    });
  }

  private send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === this.deps.WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private tearDown(): void {
    for (const r of this.remotes.values()) r.pc.close();
    this.remotes.clear();
  }

  /* ---- Protocol ----------------------------------------------------- */

  private async onMessage(raw: unknown): Promise<void> {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(raw)) as ServerMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case "joined": {
        this.selfId = msg.peerId;
        // TURN ONLY (no STUN). This viewer runs in an Electron <webview> whose
        // P2P stack has NO mDNS resolver, so host `.local` candidates never
        // resolve (-105), and it can't resolve STUN *hostnames* either
        // (stun.l.google.com / stun.cloudflare.com → -105). The only viable
        // path is the relay, and the server now advertises TURN by IP
        // (turn:51.91.126.43:3478), which needs no DNS. Dropping the unusable
        // STUN hostnames removes the -105 noise and the dead srflx gathering.
        this.iceServers = msg.turn.urls.map((url) => ({
          urls: url,
          username: msg.turn.username,
          credential: msg.turn.credential,
        }));
        this.emit("joined", { peerId: msg.peerId, peers: msg.peers });
        for (const peer of msg.peers) this.ensureRemote(peer);
        break;
      }
      case "peer-joined": {
        this.emit("peer-joined", msg.peer);
        this.ensureRemote(msg.peer);
        break;
      }
      case "peer-left": {
        const remote = this.remotes.get(msg.peerId);
        if (remote) {
          // The pc owns the tracks — closing it ends them. The registry/consumer
          // are notified via the peer-left event (label-keyed).
          remote.pc.close();
          this.remotes.delete(msg.peerId);
          this.emit("peer-left", { peerId: msg.peerId, peerName: remote.info.name });
        }
        break;
      }
      case "signal": {
        await this.handleSignal(msg.from, msg.payload);
        break;
      }
      case "error": {
        this.emit("error", { code: msg.code, message: msg.message });
        break;
      }
    }
  }

  private async handleSignal(from: string, payload: SignalPayload): Promise<void> {
    let remote = this.remotes.get(from);
    if (!remote) {
      remote = this.ensureRemote({ id: from, name: from.slice(0, 8), role: "publisher" });
    }
    const { pc } = remote;

    if (payload.kind === "sdp") {
      const desc = payload.description;
      const offerCollision =
        desc.type === "offer" && (remote.makingOffer || pc.signalingState !== "stable");
      remote.ignoreOffer = !this.isPolite(from) && offerCollision;
      if (remote.ignoreOffer) return;

      await pc.setRemoteDescription(desc);
      for (const c of remote.pendingCandidates) {
        try {
          await pc.addIceCandidate(c);
        } catch {
          /* ignore late/stale candidates */
        }
      }
      remote.pendingCandidates = [];

      if (desc.type === "offer") {
        await pc.setLocalDescription();
        if (pc.localDescription) {
          this.sendSignal(from, {
            kind: "sdp",
            description: {
              type: pc.localDescription.type as "offer" | "answer" | "pranswer" | "rollback",
              sdp: pc.localDescription.sdp,
            },
          });
        }
      }
      return;
    }

    if (payload.kind === "ice") {
      const init = payload.candidate;
      if (pc.remoteDescription) {
        try {
          await pc.addIceCandidate(init);
        } catch (err) {
          if (!remote.ignoreOffer) throw err;
        }
      } else {
        remote.pendingCandidates.push(init);
      }
      return;
    }
    // control payloads ignored — the viewer does not act on screen/mute hints.
  }

  /* ---- Peer setup --------------------------------------------------- */

  private ensureRemote(peer: PeerInfo): RemoteState {
    const existing = this.remotes.get(peer.id);
    if (existing) return existing;

    // relay-only: in the Electron <webview> host (.local) and srflx candidates
    // are unusable (no mDNS resolver, STUN hostnames unresolvable), so force the
    // ICE agent to gather/use ONLY relay candidates via the by-IP TURN server.
    // The publisher (browser) gathers all transports incl. relay, so the
    // relay↔relay pair connects. Avoids ICE stalling on dead host/srflx checks.
    const pc = new this.deps.RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: "relay",
    });
    const stream = new this.deps.MediaStream();

    // VIEWER : both transceivers are recvonly and carry NO local track. Order
    // (audio first, video second) must match the publisher's so the m-lines
    // line up — the same invariant as the reference.
    const audioTx = pc.addTransceiver("audio", { direction: "recvonly" });
    const videoTx = pc.addTransceiver("video", { direction: "recvonly" });

    // BUNDLE codec-collision fix (ADR 006 #3). A recvonly viewer offering the
    // FULL Chromium codec catalogue (VP8/VP9×profiles/H264×profiles/AV1/H265 +
    // rtx/red/ulpfec/flexfec, audio opus + telephone-event) maximises payload-
    // type pressure. Under BUNDLE all m-lines share ONE PT namespace, so when
    // the publisher (answerer, with pre-allocated sendrecv transceivers — see
    // `meet-client.ts`) reconciles that dense offer, PTs collide ACROSS m-lines
    // (the observed `126` audio telephone-event vs `39` video H264). A pure
    // viewer needs ONE coherent codec per kind, not the whole catalogue : we
    // pin a deduplicated, minimal preference set so the offered PT space is
    // small and collision-free by construction. This is NOT SDP munging — it is
    // the spec'd `setCodecPreferences` API ; Chromium still owns PT assignment.
    pinViewerCodecs(audioTx, videoTx);

    const state: RemoteState = {
      info: peer,
      pc,
      stream,
      makingOffer: false,
      ignoreOffer: false,
      pendingCandidates: [],
    };

    pc.addEventListener("negotiationneeded", () => {
      void (async () => {
        try {
          state.makingOffer = true;
          await pc.setLocalDescription();
          if (pc.localDescription) {
            this.sendSignal(peer.id, {
              kind: "sdp",
              description: {
                type: pc.localDescription.type as "offer" | "answer" | "pranswer" | "rollback",
                sdp: pc.localDescription.sdp,
              },
            });
          }
        } catch {
          /* transient — glare or mid-close */
        } finally {
          state.makingOffer = false;
        }
      })();
    });

    pc.addEventListener("icecandidate", (ev) => {
      const candidate = (ev as RTCPeerConnectionIceEvent).candidate;
      if (!candidate) return;
      this.sendSignal(peer.id, {
        kind: "ice",
        candidate: {
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
          usernameFragment: candidate.usernameFragment,
        },
      });
    });

    pc.addEventListener("track", (ev) => {
      const track = (ev as RTCTrackEvent).track;
      // Aggregate every incoming track into the peer's single MediaStream so
      // the consumer gets one coherent source for `<video srcObject>`.
      if (!state.stream.getTracks().includes(track)) {
        state.stream.addTrack(track);
      }
      track.addEventListener("ended", () => {
        state.stream.removeTrack(track);
      });
      this.emit("remote-track", {
        peerId: peer.id,
        peerName: peer.name,
        stream: state.stream,
      });
    });

    pc.addEventListener("connectionstatechange", () => {
      this.emit("connection-state", { peerId: peer.id, state: pc.connectionState });
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.remotes.delete(peer.id);
        this.emit("peer-left", { peerId: peer.id, peerName: peer.name });
      }
    });

    this.remotes.set(peer.id, state);
    return state;
  }

  /* ---- Helpers ------------------------------------------------------ */

  private isPolite(otherId: string): boolean {
    if (!this.selfId) return false;
    return this.selfId > otherId;
  }

  private sendSignal(to: string, payload: SignalPayload): void {
    this.send({ type: "signal", to, payload });
  }

  private emit<K extends keyof EventMap>(type: K, event: EventMap[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const listener of set) (listener as Listener<K>)(event);
  }
}

/* ---- Codec preference (BUNDLE collision fix) ----------------------- */

/** Pin a minimal, deduplicated codec preference on a viewer's recvonly
 *  transceivers so the offered payload-type space stays small and BUNDLE-safe.
 *
 *  AUDIO  : opus (+ keep telephone-event for spec completeness, it is harmless).
 *  VIDEO  : H264 + its rtx ONLY (drop VP9/AV1/H265 multi-profile clutter). H264
 *           is what the publisher (Prism cam / Pulsar NVENC) emits ; a viewer
 *           that only ever RECEIVES needs no broader set. rtx is kept so NACK
 *           retransmission still works.
 *
 *  Feature-detected end-to-end : if `setCodecPreferences` or
 *  `RTCRtpReceiver.getCapabilities` is unavailable (older engines, jsdom/test
 *  fakes), this is a silent no-op and the transceiver keeps Chromium's default
 *  full list — behaviour is never WORSE than before the fix. */
function pinViewerCodecs(audioTx: unknown, videoTx: unknown): void {
  const getCaps = (globalThis as { RTCRtpReceiver?: { getCapabilities?: (k: string) => RTCRtpCapabilities | null } })
    .RTCRtpReceiver?.getCapabilities;
  if (typeof getCaps !== "function") return;

  pinKind(videoTx, getCaps("video"), (mime) => {
    const m = mime.toLowerCase();
    // Keep H264 and the generic rtx (retransmission) codec only.
    return m === "video/h264" || m === "video/rtx";
  });
  pinKind(audioTx, getCaps("audio"), (mime) => {
    const m = mime.toLowerCase();
    return m === "audio/opus" || m === "audio/telephone-event";
  });
}

/** Apply `setCodecPreferences` with the subset of `caps` whose mimeType passes
 *  `keep`, preserving the platform's preferred order. Guarded : no transceiver,
 *  no `setCodecPreferences`, no caps, or an empty filtered set → no-op. */
function pinKind(
  tx: unknown,
  caps: RTCRtpCapabilities | null | undefined,
  keep: (mimeType: string) => boolean,
): void {
  const setPrefs = (tx as { setCodecPreferences?: (codecs: RTCRtpCodec[]) => void } | null)
    ?.setCodecPreferences;
  if (typeof setPrefs !== "function" || !caps) return;
  const codecs = caps.codecs.filter((c) => keep(c.mimeType));
  if (codecs.length === 0) return; // never offer an empty m-line
  try {
    setPrefs.call(tx, codecs);
  } catch {
    // Some engines reject a preference list (e.g. rtx without its apt primary in
    // the same call) — fall back to the default full list rather than break the
    // transceiver. The fix is best-effort hardening, never a hard dependency.
  }
}
