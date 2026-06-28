import type { PrimitiveProps } from "./index";
import { LivePeerVideo } from "./live-peer-video";

/** `x-zab.meet-peer` — the transparent meet-peer SLOT placeholder (Zab vendor
 *  primitive, ADR Blue 009 §3.1 Amendment 2 ; type shipped in v0.10.0 / #81).
 *
 *  Distinct from `meet.peer` (the cam-identity source) : this node carries NO
 *  peer identity, only a hash-stable LOGICAL `x-zab.slotRef` (e.g. `cam-caster-1`)
 *  + geometry. WHICH `peer_label` fills a slot is RUNTIME, stream-level ZabCam
 *  state — never baked in the scene. The slot→peer binding is ported by Orion on
 *  the LSDP as `__cam.slots.<slotRef>` = "<peer_label>" (§3.3) and re-keyed into
 *  the host's peer-stream registry (Solar `slot-binding.ts`) so the registry
 *  resolves `slotRef → peer_label → MediaStream`.
 *
 *  Contract (rendered verbatim) :
 *   - `x-zab.slotRef` (string) — the SLOT REFERENCE, used as the resolver KEY.
 *     The host's peer-stream resolver (`resolvePeerStream`/`subscribePeerStream`)
 *     is keyed by `slotRef` on the antenne (Solar's slot-aware registry maps it
 *     to a `peer_label`, then to a stream). Empty / missing → a transparent inert
 *     box (the slot is not addressable).
 *   - geometry (`width`/`height` + position) — applied by the Tree's
 *     UniversalWrapper, exactly like `meet.peer` ; the `<video>` fills the box
 *     100%/100% and is never forced full-screen (RC-Geo).
 *
 *  Receive-only : the slot reads its stream through the host viewer (Solar joins
 *  the room and owns the peer connections / track lifecycle) ; the primitive
 *  carries no creds and never mutates the scene (RC-ReadOnly). An UNBOUND slot
 *  (no `__cam.slots.*` assignment) or a not-yet-connected peer → a transparent
 *  placeholder, no throw, no diagnostic (R3). */
export function MeetPeerSlot({ resolved }: PrimitiveProps) {
  const slotRef =
    typeof resolved["x-zab.slotRef"] === "string" &&
    (resolved["x-zab.slotRef"] as string).length > 0
      ? (resolved["x-zab.slotRef"] as string)
      : "";

  // No slotRef → not addressable : a transparent inert box of the wrapper
  // geometry (no throw, no diagnostic), exactly like an unbound slot.
  if (slotRef === "") {
    return (
      <div
        aria-hidden
        data-lumencast-meet-peer-slot
        style={{ width: "100%", height: "100%", opacity: 0, pointerEvents: "none" }}
      />
    );
  }

  // Key the peer-viewer resolver by `slotRef` (NOT a peer_label). The shared
  // `LivePeerVideo` is resolver-key agnostic : it passes its `peerLabel` prop
  // straight to `resolvePeerStream`/`subscribePeerStream`, and the host's
  // slot-aware registry translates the slotRef to the bound peer's stream. An
  // unbound slot resolves to `null` → the transparent placeholder.
  return <LivePeerVideo peerLabel={slotRef} objectFit="cover" muted />;
}
