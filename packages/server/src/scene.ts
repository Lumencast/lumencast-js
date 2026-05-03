// Scene — the server's authoritative view of one Lumencast scene.
// Wraps a LeafStore + identity (sceneId, sceneVersion) and an optional
// operator_inputs schema used by the server to validate `input` frames.

import type { Cause, LeafPath, LeafValue, Patch, SceneId, SceneVersion } from "@lumencast/protocol";
import { LeafStore } from "./store.js";
import { DEFAULT_REPLAY_BUFFER_SIZE, ReplayBuffer, type ReplayRecord } from "./replay-buffer.js";

export interface OperatorInputDecl {
  path: LeafPath;
  /** "string" | "number" | "boolean" | "enum" | ... — see LSML 1.0 §8. */
  type: string;
  /** Type-specific constraints — currently maxLength, minLength, min, max, pattern. */
  constraints?: {
    maxLength?: number;
    minLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
  };
  values?: unknown[];
  writable_by?: string[];
  [extra: string]: unknown;
}

export interface SceneInit {
  sceneId: SceneId;
  sceneVersion: SceneVersion;
  initialState?: Record<LeafPath, LeafValue>;
  /** Declared operator inputs. When set, `validateInput` enforces the schema. */
  operatorInputs?: OperatorInputDecl[];
}

export type ValidationError =
  | { code: "UNKNOWN_PATH"; path: LeafPath; message: string }
  | { code: "INVALID_VALUE"; path: LeafPath; message: string };

export interface Scene {
  readonly sceneId: SceneId;
  readonly sceneVersion: SceneVersion;
  readonly store: LeafStore;
  readonly operatorInputs: OperatorInputDecl[];
  /** Update one or more leaves. Atomic per call. Optional `cause` propagates
   * to subscribers as the resulting Delta.cause (LSDP/1.1 §3.2.3). */
  update(patches: Patch[] | Record<LeafPath, LeafValue>, cause?: Cause): void;
  /** Subscribe to all patches emitted by this scene. The listener receives
   * the per-scene `seq` (LSDP/1.1 §18.1.1) — the same value across all
   * concurrent listeners on a given delta. */
  onPatches(listener: (seq: number, patches: Patch[], cause?: Cause) => void): () => void;
  /** Current per-scene seq counter (LSDP/1.1 §18.1.1). 1 on a fresh
   * scene ; increments on every emit. Late-joining subscribers ship
   * snapshot at this value. */
  currentSeq(): number;
  /** Replay records strictly after `sinceSeq` for §18.1 resume.
   * Returns `covered: false` when sinceSeq is older than the buffer's
   * earliest entry — the caller MUST fall back to a fresh snapshot. */
  replaySince(sinceSeq: number): { records: ReplayRecord[]; covered: boolean };
  /**
   * Validate input patches against the declared operator_inputs schema.
   * Returns the first error or null. The reserved `__test.*` namespace is
   * always permitted (test sessions own that namespace per LSDP/1 §10).
   */
  validateInput(patches: Patch[]): ValidationError | null;
}

export function createScene(init: SceneInit): Scene {
  const store = new LeafStore(init.initialState ?? {});
  const operatorInputs = init.operatorInputs ?? [];
  const inputsByPath = new Map<LeafPath, OperatorInputDecl>();
  for (const oi of operatorInputs) inputsByPath.set(oi.path, oi);

  // LSDP/1.1 §18.1.1 — per-scene monotonic seq. Pre-seeded to 1 so the
  // very first subscriber's snapshot ships at seq=1 (matches every
  // existing 1.0 conformance scenario). Subsequent emits increment.
  let seq = 1;
  const replay = new ReplayBuffer(DEFAULT_REPLAY_BUFFER_SIZE);
  type SceneListener = (seq: number, patches: Patch[], cause?: Cause) => void;
  const sceneListeners = new Set<SceneListener>();

  // Bridge LeafStore.onPatches → scene listeners. Single store listener
  // increments `seq`, records to the buffer, fans out to scene listeners.
  store.onPatches((patches, cause) => {
    seq += 1;
    replay.push({ seq, patches: patches.slice(), cause });
    for (const l of sceneListeners) l(seq, patches, cause);
  });

  function update(input: Patch[] | Record<LeafPath, LeafValue>, cause?: Cause): void {
    const patches: Patch[] = Array.isArray(input)
      ? input
      : Object.entries(input).map(([path, value]) => ({ path, value }));
    store.apply(patches, cause);
  }

  function validateInput(patches: Patch[]): ValidationError | null {
    // No declared schema → server accepts any path (legacy / dev-mode behavior).
    if (operatorInputs.length === 0) return null;

    for (const p of patches) {
      if (p.path.startsWith("__test.")) continue; // test namespace bypass
      const decl = inputsByPath.get(p.path);
      if (!decl) {
        return {
          code: "UNKNOWN_PATH",
          path: p.path,
          message: `path ${p.path} not declared in operator_inputs`,
        };
      }
      const err = checkConstraint(decl, p.value);
      if (err) return { code: "INVALID_VALUE", path: p.path, message: err };
    }
    return null;
  }

  return {
    sceneId: init.sceneId,
    sceneVersion: init.sceneVersion,
    store,
    operatorInputs,
    update,
    onPatches: (listener) => {
      sceneListeners.add(listener);
      return () => {
        sceneListeners.delete(listener);
      };
    },
    currentSeq: () => seq,
    replaySince: (sinceSeq) => replay.since(sinceSeq),
    validateInput,
  };
}

function checkConstraint(decl: OperatorInputDecl, value: unknown): string | null {
  switch (decl.type) {
    case "string":
    case "text":
      if (typeof value !== "string") return `expected string, got ${typeof value}`;
      if (decl.constraints?.maxLength !== undefined && value.length > decl.constraints.maxLength) {
        return `exceeds maxLength ${decl.constraints.maxLength}`;
      }
      if (decl.constraints?.minLength !== undefined && value.length < decl.constraints.minLength) {
        return `below minLength ${decl.constraints.minLength}`;
      }
      if (decl.constraints?.pattern && !new RegExp(decl.constraints.pattern).test(value)) {
        return `does not match pattern`;
      }
      return null;
    case "number":
      if (typeof value !== "number") return `expected number, got ${typeof value}`;
      if (decl.constraints?.min !== undefined && value < decl.constraints.min) {
        return `below min ${decl.constraints.min}`;
      }
      if (decl.constraints?.max !== undefined && value > decl.constraints.max) {
        return `above max ${decl.constraints.max}`;
      }
      return null;
    case "boolean":
      if (typeof value !== "boolean") return `expected boolean, got ${typeof value}`;
      return null;
    case "enum":
      if (decl.values && !decl.values.includes(value)) {
        return `not in enum`;
      }
      return null;
    default:
      return null;
  }
}
