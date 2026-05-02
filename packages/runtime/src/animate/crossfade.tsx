import { type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";

export interface CrossfadeProps {
  /** Scene id or any stable key — children remount on key change. */
  trackKey: string;
  /** Duration in milliseconds. */
  durationMs?: number;
  children: ReactNode;
}

/** Crossfade two scene roots at key change. Both children are mounted
 *  during the transition window, one fading out as the other fades in.
 *  Animates opacity only (GPU-friendly). */
export function Crossfade({ trackKey, durationMs = 400, children }: CrossfadeProps) {
  const transition = { duration: durationMs / 1000, ease: "easeInOut" } as const;
  return (
    <AnimatePresence mode="sync">
      <motion.div
        key={trackKey}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={transition}
        style={{ position: "absolute", inset: 0 }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
