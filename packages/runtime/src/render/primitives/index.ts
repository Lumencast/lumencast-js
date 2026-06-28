// Primitive component registry. Tree dispatch uses this map to look
// up the React component for each `kind` ; user components are inlined
// at compile time so Lumencast's runtime never sees them.

import type { ComponentType, ReactNode } from "react";
import type { RenderKind } from "../bundle";
import type { Transition } from "../../animate/transitions";
import { Stack } from "./stack";
import { Grid } from "./grid";
import { Frame } from "./frame";
import { Text } from "./text";
import { Image } from "./image";
import { Shape } from "./shape";
import { Media } from "./media";
import { MeetPeer } from "./meet-peer";
import { MeetPeerSlot } from "./meet-peer-slot";
import { Instance } from "./instance";
import { Capture } from "./capture";
// `repeat` is dispatched specially in the tree (it iterates a bound
// array and provides a path scope to its children) ; it does not
// appear here as a regular primitive.

export interface PrimitiveProps {
  resolved: Record<string, unknown>;
  /** `RenderNode.id` of the node being rendered — threaded into every
   *  diagnostic the primitive emits (ADR 001 RC#7, issue #34). */
  nodeId?: string;
  transitionFor: (key: string) => Transition | undefined;
  /** LSML 1.1 `animate.from` lowered to a flat framer `initial` map
   *  (keys: `opacity`, `scale`, `rotate`, `x`, `y`). When present, a
   *  motion primitive passes it as framer-motion `initial={...}` so the
   *  element mounts in this state and animates to its rendered target on
   *  mount (mount-play). `undefined` → no `initial` (no mount-play). */
  animateInitial?: Record<string, number | string>;
  /** ADR 002 §3.1 (D1) — set by the Tree when this node has at least one
   *  absolutely positioned child. A layout container (`stack`/`grid`)
   *  flips to `position: relative` so its children's `left/top` resolve
   *  against it. `frame` is already `position: absolute` (a containing
   *  block) and ignores it ; leaf primitives have no children and ignore
   *  it too. `false`/absent → no change (pure auto-layout, RC#2). */
  establishesContainingBlock?: boolean;
  children?: ReactNode;
}

export const PRIMITIVES: Partial<Record<RenderKind, ComponentType<PrimitiveProps>>> = {
  stack: Stack,
  grid: Grid,
  frame: Frame,
  text: Text,
  image: Image,
  shape: Shape,
  media: Media,
  // ADR 006 §3.3/§3.5 — the unified source kind : every exported source is a
  // `meet.peer` node rendered in `<video srcObject>` from the WebRTC viewer.
  "meet.peer": MeetPeer,
  instance: Instance,
  // RFC-0001 / ADR 004 — Zab vendor capture placeholder (transparent, inert).
  "x-zab.capture": Capture,
  // ADR Blue 009 §3.1 (Amendment 2) — Zab vendor meet-peer SLOT placeholder.
  // Carries only a logical `x-zab.slotRef` ; the host's slot-aware peer-stream
  // registry resolves `slotRef → peer_label → MediaStream` (transparent when
  // unbound). Closes the kind→primitive gap that left it an unknown-kind drop.
  "x-zab.meet-peer": MeetPeerSlot,
};
