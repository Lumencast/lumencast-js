// Reserved `__cam.*` LSDP leaves — surfaced to the host, never rendered.
//
// ADR Blue 009 §3.2–3.3 (axe 1, antenne). The meet-cam antenne path needs two
// pieces of RUNTIME, stream-level ZabCam state that travel on the LSDP wire as
// RESERVED leaves (they bind to no node and are never painted) :
//
//   - `__cam.slots.<slotRef>` = "<peer_label>"  (Orion #267 deltas, §3.3)
//        which peer currently fills an authored `x-zab.meet-peer` slot.
//   - `__cam.viewer` = { rooms: [{ signalingUrl, roomId, token }] }  (Orion #268)
//        the receive-only viewer credentials for the active stream.
//
// The runtime does NOT join rooms, hold creds, or re-key slots itself — that is
// the host's WebRTC viewer (Solar `peer-viewer/*`). The runtime's only job is to
// SURFACE these reserved leaves to the host through `MountOptions.onReservedLeaves`
// so Solar can feed `__cam.viewer` into its viewer injection and drive its
// slot-binding registry's `assign(slotRef, peer_label | null)` from `__cam.slots.*`.
// Receive-only : the token flows host→viewer→join ; the runtime never reads it.

/** Every reserved cam leaf lives under this prefix. */
export const CAM_RESERVED_PREFIX = "__cam.";

/** One scalar leaf per bound slot : `__cam.slots.<slotRef>` = "<peer_label>"
 *  (ADR Blue 009 §3.3). Mirrors Solar's `CAM_SLOTS_PREFIX` — keep them in sync. */
export const CAM_SLOTS_PREFIX = "__cam.slots.";

/** The single viewer-credentials leaf (ADR Blue 009 §3.2, Orion #268). */
export const CAM_VIEWER_LEAF = "__cam.viewer";

/** The reserved cam state surfaced to the host in one shot on every change. */
export interface ReservedCamLeaves {
  /** `__cam.viewer` — receive-only viewer creds for the active stream. Opaque to
   *  the runtime (shape `{ rooms: [{ signalingUrl, roomId, token }] }` validated
   *  host-side) ; `undefined` when the leaf is absent. */
  viewer?: unknown;
  /** `slotRef → peer_label` snapshot from the `__cam.slots.*` subtree. A slot
   *  ABSENT from this map is UNBOUND — the host releases it (`assign(slotRef,
   *  null)`) so the `x-zab.meet-peer` node falls back to its placeholder. Only
   *  non-empty string values are kept. */
  slots: Record<string, string>;
}

/** A reserved cam leaf the runtime forwards rather than renders. */
export function isReservedCamPath(path: string): boolean {
  return path === CAM_VIEWER_LEAF || path.startsWith(CAM_SLOTS_PREFIX);
}

/** Project a raw reserved-leaf state into the host-facing shape. Defensive : a
 *  malformed slot value (non-string / empty) or empty slotRef is dropped. */
function project(raw: Map<string, unknown>): ReservedCamLeaves {
  const slots: Record<string, string> = {};
  let viewer: unknown;
  for (const [path, value] of raw) {
    if (path === CAM_VIEWER_LEAF) {
      if (value !== undefined && value !== null) viewer = value;
    } else if (path.startsWith(CAM_SLOTS_PREFIX)) {
      const slotRef = path.slice(CAM_SLOTS_PREFIX.length);
      if (slotRef !== "" && typeof value === "string" && value !== "") slots[slotRef] = value;
    }
  }
  return viewer !== undefined ? { viewer, slots } : { slots };
}

/** A stable identity key for change detection — two `ReservedCamLeaves` with the
 *  same content always produce the same key regardless of insertion order. */
function identity(leaves: ReservedCamLeaves): string {
  const slots = Object.keys(leaves.slots)
    .sort()
    .map((k) => `${k}=${leaves.slots[k]}`)
    .join("&");
  const viewer = leaves.viewer === undefined ? "" : JSON.stringify(leaves.viewer);
  return `${slots}|${viewer}`;
}

export interface ReservedLeafObserver {
  /** Reseed from a full snapshot's state (reserved leaves not present are
   *  dropped). Emits when the projected state changed. */
  onSnapshot(state: Record<string, unknown>): void;
  /** Apply a delta's patches ; emits only when a reserved leaf actually moved. */
  onDelta(patches: ReadonlyArray<{ path: string; value: unknown }>): void;
}

/** Track the reserved `__cam.*` leaves across snapshots + deltas and `emit` the
 *  host-facing projection whenever it changes (de-duplicated by content, so an
 *  unrelated scene's deltas never call back). Created only when the host supplies
 *  `onReservedLeaves` — zero cost otherwise. */
export function createReservedLeafObserver(
  emit: (leaves: ReservedCamLeaves) => void,
): ReservedLeafObserver {
  const raw = new Map<string, unknown>();
  // Seed with the empty projection's identity so a plain scene (no cam leaves)
  // never fires a spurious empty emit ; a later transition to/from cam state does.
  let last = identity({ slots: {} });

  const flush = (): void => {
    const leaves = project(raw);
    const key = identity(leaves);
    if (key === last) return;
    last = key;
    emit(leaves);
  };

  return {
    onSnapshot(state) {
      raw.clear();
      for (const [path, value] of Object.entries(state)) {
        if (isReservedCamPath(path)) raw.set(path, value);
      }
      flush();
    },
    onDelta(patches) {
      let touched = false;
      for (const patch of patches) {
        if (isReservedCamPath(patch.path)) {
          raw.set(patch.path, patch.value);
          touched = true;
        }
      }
      if (touched) flush();
    },
  };
}
