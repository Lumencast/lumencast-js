// Peer-stream registry — the bridge between the WebRTC viewer (#3) and the
// `media` primitive's LIVE mode (#4).
//
// The viewer feeds this registry one entry per CONNECTED peer, keyed by the
// peer's STABLE `peer_label` (the ZabCam contract label #6, announced on the
// mesh as the peer's join `name` — see `PeerInfo.name` / `RemoteTrackEvent`).
// The `media` primitive resolves `peerLabel → MediaStream` through it.
//
// Reactivity : a peer's stream becomes available ASYNCHRONOUSLY (after the room
// join + SDP/ICE), so a `media` node that mounted before the peer connected
// must be notified when its stream arrives. The registry exposes both a
// one-shot `resolvePeerStream` (the #4 contract, synchronous) AND a
// `subscribePeerStream(label, cb)` push channel the LIVE primitive uses to
// re-render on connect / disconnect. The store is a plain Map guarded by a
// listener set — no signals dependency, so it adds nothing to the render path.
//
// OWNERSHIP (the #3↔#4 lifecycle decision) : the registry NEVER creates or
// stops a track. It only HOLDS a reference to a `MediaStream` owned by the
// viewer's `RTCPeerConnection`. The viewer is the sole authority on the track
// lifecycle (created on `track`, removed on `ended` / `peer-left` / teardown).
// A consuming `<video>` unmounting clears its own `srcObject` and nothing else
// — it can never tear a peer down for the on-air composite.

export type PeerStreamListener = (stream: MediaStream | null) => void;

/** Notified whenever the live roster changes ORDER (a peer connects for the first
 *  time, or a connected peer drops). A pure re-`set` of an already-present label's
 *  stream is NOT a roster change (same arrival order) — it reaches per-label
 *  `subscribe` listeners only. Carries no payload : the listener re-reads
 *  `orderedLabels()`. */
export type RosterListener = () => void;

export interface PeerStreamRegistry {
  /** #4 contract — the current stream for a label, or `null` if the peer is not
   *  connected (yet / any more). Synchronous, side-effect free. */
  resolve(peerLabel: string): MediaStream | null;
  /** The live `peer_label`s in ARRIVAL ORDER (insertion order of the backing Map,
   *  restricted to labels that currently hold a stream). Drives positional slot
   *  resolution (`@<n>` → `orderedLabels()[n]`, ADR Blue 009 axe 1 positional
   *  variant). Returns a fresh array — safe for the caller to keep / index. */
  orderedLabels(): string[];
  /** Push channel for the LIVE `media` primitive : invoked immediately with the
   *  current value, then on every change for `peerLabel`. Returns an
   *  unsubscribe. */
  subscribe(peerLabel: string, listener: PeerStreamListener): () => void;
  /** Roster-change channel : invoked whenever a peer connects (new label) or
   *  leaves (label dropped) — i.e. whenever `orderedLabels()` could shift. Lets a
   *  positional consumer re-resolve `@<n>` when arrivals/departures shuffle the
   *  order. NOT invoked on a pure stream replacement of an existing label. Returns
   *  an unsubscribe. */
  subscribeRoster(listener: RosterListener): () => void;
  /** Viewer-side : publish / replace a peer's stream (peer connected). */
  set(peerLabel: string, stream: MediaStream): void;
  /** Viewer-side : drop a peer's stream (peer left / connection failed). The
   *  registry forgets the reference ; it does NOT stop the tracks (the viewer's
   *  pc.close() does, as the track owner). */
  remove(peerLabel: string): void;
  /** Viewer-side : forget every entry (room teardown). Reference-only, no track
   *  stops. */
  clear(): void;
}

export function createPeerStreamRegistry(): PeerStreamRegistry {
  const streams = new Map<string, MediaStream>();
  const listeners = new Map<string, Set<PeerStreamListener>>();
  const rosterListeners = new Set<RosterListener>();

  function notify(peerLabel: string): void {
    const set = listeners.get(peerLabel);
    if (set === undefined) return;
    const value = streams.get(peerLabel) ?? null;
    for (const listener of set) listener(value);
  }

  function notifyRoster(): void {
    for (const listener of [...rosterListeners]) listener();
  }

  return {
    resolve(peerLabel) {
      return streams.get(peerLabel) ?? null;
    },
    orderedLabels() {
      // Map preserves insertion order = arrival order ; every key holds a stream
      // (a dropped peer is `delete`d in remove()).
      return [...streams.keys()];
    },
    subscribeRoster(listener) {
      rosterListeners.add(listener);
      return () => {
        rosterListeners.delete(listener);
      };
    },
    subscribe(peerLabel, listener) {
      let set = listeners.get(peerLabel);
      if (set === undefined) {
        set = new Set();
        listeners.set(peerLabel, set);
      }
      set.add(listener);
      // Emit the current value synchronously so a late subscriber sees an
      // already-connected peer without waiting for the next change.
      listener(streams.get(peerLabel) ?? null);
      return () => {
        const s = listeners.get(peerLabel);
        if (s === undefined) return;
        s.delete(listener);
        if (s.size === 0) listeners.delete(peerLabel);
      };
    },
    set(peerLabel, stream) {
      if (streams.get(peerLabel) === stream) return; // idempotent re-emit guard
      const isNew = !streams.has(peerLabel); // a brand-new arrival shifts the roster
      streams.set(peerLabel, stream);
      notify(peerLabel);
      if (isNew) notifyRoster();
    },
    remove(peerLabel) {
      if (!streams.has(peerLabel)) return;
      streams.delete(peerLabel);
      notify(peerLabel);
      notifyRoster(); // a departure shifts every later position
    },
    clear() {
      const labels = [...streams.keys()];
      streams.clear();
      for (const label of labels) notify(label);
      if (labels.length > 0) notifyRoster();
    },
  };
}
