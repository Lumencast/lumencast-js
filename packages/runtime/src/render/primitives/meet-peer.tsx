import type { PrimitiveProps } from "./index";
import { LivePeerVideo } from "./live-peer-video";

/** `meet.peer` — the UNIFIED source primitive (ADR 006 §3.3/§3.5). Every source
 *  that crosses the Prism export (cam, screen, game_capture, …) arrives as a
 *  single `meet.peer` LSML node ; this is the ONE renderer for all of them — not
 *  a special-case path. It generalises the `media` primitive's live mode (#4) to
 *  the source abstraction : read `peer_label`, resolve the peer's `MediaStream`
 *  through the host viewer (#3), and paint it in `<video srcObject>` constrained
 *  to the node's box.
 *
 *  Contract (rendered verbatim, ADR §3.3 — no variation) :
 *   - `peer_label` (string) — the STREAM REFERENCE. Resolved `peer_label →
 *     MediaStream` via `subscribePeerStream`/`resolvePeerStream`. Empty / missing
 *     → a transparent inert box (the source is not addressable).
 *   - `x-zab.sourceKind` (string) — ADVISORY only. Rendering is UNIFORM whatever
 *     the kind ; at most it could hint audio-only, but Phase 0 paints every
 *     visual source identically.
 *   - `object_fit` ("cover"|"contain"|"fill") — how the video fills the box.
 *   - `muted` (bool, optional) — audio playout hint (default muted ; broadcast
 *     audio is Pulsar-side).
 *   - `position{x,y}` + `size{w,h}` — geometry via the Tree's UniversalWrapper
 *     (compiler-flattened to `x/y/width/height`). Z-ORDER = sibling order (cam
 *     over game = two ordered `meet.peer` nodes — no special z handling here).
 *   - `metadata.figma` — advisory (editor round-trip), never read for rendering.
 *
 *  RC-Geo : the `<video>` fills `100%`/`100%` of the wrapper box at the exact
 *  authored geometry / `object_fit` — never forced full-screen (the geometry is
 *  on the wrapper, not the video). RC-ReadOnly : the primitive only READS
 *  `resolved` ; it never writes geometry or any field back to the scene. An
 *  unconnected peer → transparent inert box, no throw, no diagnostic. */
export function MeetPeer({ resolved }: PrimitiveProps) {
  const peerLabel =
    typeof resolved.peer_label === "string" && resolved.peer_label.length > 0
      ? resolved.peer_label
      : "";

  // Empty / missing label → not addressable yet : a transparent inert box of the
  // wrapper geometry, exactly like an unconnected peer (no throw, no diagnostic).
  if (peerLabel === "") {
    return (
      <div
        aria-hidden
        data-lumencast-meet-peer
        style={{ width: "100%", height: "100%", opacity: 0, pointerEvents: "none" }}
      />
    );
  }

  const objectFit =
    typeof resolved.object_fit === "string" && resolved.object_fit.length > 0
      ? resolved.object_fit
      : "cover";
  const muted = resolved.muted === undefined ? true : resolved.muted !== false;

  return <LivePeerVideo peerLabel={peerLabel} objectFit={objectFit} muted={muted} />;
}
