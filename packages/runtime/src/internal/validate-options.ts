import type { MountOptions } from "../types";

/** Throws on invalid mount options. Exposed separately so unit tests
 *  can exercise it without mounting a real React root. */
export function validateOptions(options: MountOptions): void {
  if (!(options.target instanceof HTMLElement)) {
    throw new TypeError("mount: `target` must be an HTMLElement");
  }
  if (typeof options.serverUrl !== "string" || options.serverUrl.length === 0) {
    throw new TypeError("mount: `serverUrl` must be a non-empty string");
  }
  if (options.mode === "test") {
    if (!options.testSession) {
      throw new TypeError("mount: `testSession` is required when mode === 'test'");
    }
    if (!options.scene) {
      throw new TypeError("mount: `scene` is required when mode === 'test'");
    }
  }
}
