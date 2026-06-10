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
import { Instance } from "./instance";
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
  instance: Instance,
};
