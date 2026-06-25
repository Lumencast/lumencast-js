// WebRTC viewer — public surface (ADR 006 §3.3, issue #3).
//
// `createPeerViewer` wires a `MeetViewer` (mesh, viewer role) to a
// `PeerStreamRegistry` and returns the `resolvePeerStream` / `subscribePeerStream`
// the `media` primitive's LIVE mode (#4) consumes via `MountOptions`. This is
// the #3↔#4 bridge : the viewer receives peers, the registry maps
// `peer_label → MediaStream`, the primitive renders it in `<video srcObject>`.
//
// MULTI-ROOM (final model) : `createMultiRoomPeerViewer({ rooms: [...] })` joins
// EVERY room with its own mesh and feeds ONE shared registry, so the `meet.peer`
// renderer resolves a `peer_label` to its stream whatever room it came from.

import { MeetViewer, type MeetViewerOptions, type RemoteTrackEvent } from "./meet-viewer.js";
import {
  createPeerStreamRegistry,
  type PeerStreamListener,
  type PeerStreamRegistry,
} from "./peer-stream-registry.js";

export {
  MeetViewer,
  type MeetViewerOptions,
  type MeetViewerDeps,
  type PeerInfo,
  type RemoteTrackEvent,
} from "./meet-viewer.js";
export {
  createPeerStreamRegistry,
  type PeerStreamRegistry,
  type PeerStreamListener,
} from "./peer-stream-registry.js";

export interface PeerViewer {
  /** Join the room(s) (viewer role, no capture). */
  join: () => Promise<void>;
  /** Leave + tear down all peer connections (the track owner releases here). */
  leave: () => void;
  /** #4 contract — pass to `mount({ resolvePeerStream })`. Synchronous. */
  resolvePeerStream: (peerLabel: string) => MediaStream | null;
  /** Push channel for the LIVE primitive to re-render on connect/disconnect. */
  subscribePeerStream: (peerLabel: string, listener: PeerStreamListener) => () => void;
  /** The underlying registry, for advanced hosts. */
  registry: PeerStreamRegistry;
  /** Single-room only — the underlying mesh, for diagnostics. Absent in the
   *  multi-room viewer (it owns N meshes). */
  viewer?: MeetViewer;
}

/** Feed a (possibly shared) registry from ONE viewer's lifecycle. A label is
 *  owned by the FIRST room that connects it (`label-collision` policy) : `claim`
 *  decides whether this viewer may publish/withdraw a given label, so a second
 *  room carrying the same `peer_label` never clobbers the first. Returns the
 *  viewer + a `dispose` that closes the mesh and releases this viewer's labels. */
/** Normalise a peer name / peer_label into the SAME key both sides agree on.
 *  The publisher announces a FREE name on the mesh (e.g. "Publisher 366"), but
 *  the scene's `peer_label` is slugified at LSML export (from-scene → "publisher
 *  _366", per source-node.ts `slugifyToLabel`). Strict `peerName === peer_label`
 *  therefore never matches. Applying the SAME slug to BOTH the indexing side
 *  (peerName) and the resolution side (peer_label) makes the map work regardless
 *  of format (a raw label and its slug collapse to the same key). Mirrors
 *  Prism `slugifyToLabel`. */
export function labelKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");
}

function wireViewer(
  viewer: MeetViewer,
  registry: PeerStreamRegistry,
  claim: { acquire: (label: string, viewer: MeetViewer) => boolean; release: (label: string, viewer: MeetViewer) => void },
): void {
  // Index the registry by the NORMALISED label (slug of peerName), so it matches
  // the scene node's slugified `peer_label`. Never the opaque `peerId`.
  viewer.on("remote-track", (e: RemoteTrackEvent) => {
    const key = labelKey(e.peerName);
    if (claim.acquire(key, viewer)) registry.set(key, e.stream);
  });
  viewer.on("peer-left", (e) => {
    const key = labelKey(e.peerName);
    if (claim.acquire(key, viewer)) {
      registry.remove(key);
      claim.release(key, viewer);
    }
  });
}

/** Single-room ownership : trivially, this lone viewer owns every label. */
const SOLE_OWNER = {
  acquire: () => true,
  release: () => {},
};

/** Build a viewer + registry for a SINGLE room and expose the #4 resolver.
 *  (Back-compat surface — `createMultiRoomPeerViewer` is the final model.) */
export function createPeerViewer(options: MeetViewerOptions): PeerViewer {
  const registry = createPeerStreamRegistry();
  const viewer = new MeetViewer(options);
  wireViewer(viewer, registry, SOLE_OWNER);
  return {
    join: () => viewer.join(),
    leave: () => {
      viewer.leave();
      registry.clear();
    },
    resolvePeerStream: (peerLabel) => registry.resolve(labelKey(peerLabel)),
    subscribePeerStream: (peerLabel, listener) => registry.subscribe(labelKey(peerLabel), listener),
    registry,
    viewer,
  };
}

/** A single room's connection params (one mesh per entry). */
export type RoomOptions = Omit<MeetViewerOptions, "name"> & {
  /** This viewer's announce name on the mesh. Defaults to "solar-viewer". */
  name?: string;
};

export interface MultiRoomPeerViewerOptions {
  rooms: RoomOptions[];
  /** Shared deps (WS/RTCPeerConnection/MediaStream) applied to every room when a
   *  room entry does not override them — used to test without a browser stack. */
  deps?: MeetViewerOptions["deps"];
}

export interface MultiRoomPeerViewer extends PeerViewer {
  /** Reconcile the live room set : open meshes for new rooms, close meshes for
   *  removed ones (matched by `roomId`). Best-effort ; idempotent for an
   *  unchanged set. Newly opened rooms are joined immediately. */
  setRooms: (rooms: RoomOptions[]) => Promise<void>;
}

/** The FINAL viewer model : join N rooms, aggregate every peer into ONE shared
 *  registry keyed by `peer_label`. The `meet.peer` renderer resolves a label to
 *  its stream regardless of which room the peer published in.
 *
 *  LABEL COLLISION (improbable at the POC) : FIRST-CONNECTED-WINS. The room that
 *  first connects a `peer_label` owns it ; a second room carrying the same label
 *  is ignored until the owner releases it (on the owner's `peer-left`). This is
 *  deterministic and never flips a live source under the compositor.
 *
 *  LIFECYCLE : one mesh per room ; `leave()` closes all. `setRooms()` reconciles
 *  on re-arm (close removed rooms, open new ones), matched by `roomId`. */
export function createMultiRoomPeerViewer(
  options: MultiRoomPeerViewerOptions,
): MultiRoomPeerViewer {
  const registry = createPeerStreamRegistry();
  // roomId → { viewer, joined }
  const meshes = new Map<string, { viewer: MeetViewer }>();
  // peer_label → owning viewer (first-connected-wins).
  const owners = new Map<string, MeetViewer>();

  const claim = {
    acquire: (label: string, viewer: MeetViewer): boolean => {
      const owner = owners.get(label);
      if (owner === undefined) {
        owners.set(label, viewer);
        return true;
      }
      return owner === viewer; // only the owning room may publish/withdraw
    },
    release: (label: string, viewer: MeetViewer): void => {
      if (owners.get(label) === viewer) owners.delete(label);
    },
  };

  function openRoom(room: RoomOptions): void {
    if (meshes.has(room.roomId)) return; // idempotent
    const viewer = new MeetViewer({
      name: room.name ?? "solar-viewer",
      ...room,
      ...(options.deps !== undefined && room.deps === undefined ? { deps: options.deps } : {}),
    });
    wireViewer(viewer, registry, claim);
    meshes.set(room.roomId, { viewer });
  }

  function closeRoom(roomId: string): void {
    const mesh = meshes.get(roomId);
    if (mesh === undefined) return;
    // Release every label this viewer owns BEFORE closing, so a surviving room
    // can take over the label and the registry drops the gone stream.
    for (const [label, owner] of [...owners.entries()]) {
      if (owner === mesh.viewer) {
        registry.remove(label);
        owners.delete(label);
      }
    }
    mesh.viewer.leave();
    meshes.delete(roomId);
  }

  for (const room of options.rooms) openRoom(room);

  return {
    join: async () => {
      await Promise.all([...meshes.values()].map((m) => m.viewer.join()));
    },
    leave: () => {
      for (const roomId of [...meshes.keys()]) closeRoom(roomId);
      registry.clear();
    },
    setRooms: async (rooms) => {
      const next = new Set(rooms.map((r) => r.roomId));
      // Close rooms no longer present.
      for (const roomId of [...meshes.keys()]) {
        if (!next.has(roomId)) closeRoom(roomId);
      }
      // Open + join rooms newly added.
      const added: MeetViewer[] = [];
      for (const room of rooms) {
        if (!meshes.has(room.roomId)) {
          openRoom(room);
          const m = meshes.get(room.roomId);
          if (m) added.push(m.viewer);
        }
      }
      await Promise.all(added.map((v) => v.join()));
    },
    resolvePeerStream: (peerLabel) => registry.resolve(labelKey(peerLabel)),
    subscribePeerStream: (peerLabel, listener) => registry.subscribe(labelKey(peerLabel), listener),
    registry,
  };
}

/** The shape the Prism host injects on `window.__ZAB_PEER_VIEWER__`. The FINAL
 *  model is the multi-room `{ rooms: [...] }` ; the legacy single-room shape is
 *  still accepted for back-compat (treated as a one-room array). */
export type PeerViewerInjection =
  | MultiRoomPeerViewerOptions
  | (Omit<MeetViewerOptions, "name"> & { name?: string });

/** Normalise either injection shape into a multi-room viewer. forge-prism passes
 *  `window.__ZAB_PEER_VIEWER__` straight through ; a bare single-room object is
 *  wrapped as `{ rooms: [it] }`. */
export function createPeerViewerFromInjection(
  injection: PeerViewerInjection,
): MultiRoomPeerViewer {
  if ("rooms" in injection && Array.isArray(injection.rooms)) {
    return createMultiRoomPeerViewer(injection);
  }
  // Legacy single-room shape → one-room array.
  const { name, deps, ...room } = injection as Omit<MeetViewerOptions, "name"> & {
    name?: string;
  };
  return createMultiRoomPeerViewer({
    rooms: [{ ...room, ...(name !== undefined ? { name } : {}) }],
    ...(deps !== undefined ? { deps } : {}),
  });
}
