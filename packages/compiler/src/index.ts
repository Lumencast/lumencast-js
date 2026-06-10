// Public surface of @lumencast/compiler.

export {
  compileBundle,
  validatePathData,
  MAX_FILTER_BLUR_PX,
  MAX_FILTER_BRIGHTNESS,
  MAX_PATH_SUBPATH_BYTES,
  MAX_PATH_SUBPATHS,
  MAX_PATH_COMMANDS,
  type CompileOptions,
} from "./compile.js";
export { canonicalize, hashBundle, ZERO_HASH } from "./canonicalize.js";
export type {
  LSMLBundle,
  LSMLNode,
  LSMLPrimitiveKind,
  LSMLBindObject,
  LSMLAnimateDirective,
  LSMLFill,
  LSMLFillStop,
  LSMLStroke,
  LSMLPath,
  LSMLKeyframes,
  LSMLKeyframeStep,
  LSMLStack,
  LSMLGrid,
  LSMLFrame,
  LSMLText,
  LSMLImage,
  LSMLShape,
  LSMLMedia,
  LSMLRepeat,
  LSMLInstance,
  LSMLOperatorInput,
} from "./lsml-types.js";
