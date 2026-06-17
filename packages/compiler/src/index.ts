// Public surface of @lumencast/compiler.

export {
  compileBundle,
  validatePathData,
  BIND_ANIMATE_SCALAR_KEYS,
  BIND_ANIMATE_COLOR_KEYS,
  MAX_FILTER_BLUR_PX,
  MAX_FILTER_BRIGHTNESS,
  MAX_PATH_SUBPATH_BYTES,
  MAX_PATH_SUBPATHS,
  MAX_PATH_COMMANDS,
  type CompileOptions,
  type CompileDiagnostic,
} from "./compile.js";
export { canonicalize, hashBundle, ZERO_HASH } from "./canonicalize.js";

export {
  BLEND_MODES,
  OBJECT_FITS,
  MASK_TYPES,
  MASK_OPS,
  MAX_GRADIENT_TRANSFORM_ABS,
  parseBlendMode,
  parseObjectFit,
  clampGradientTransform,
} from "./lsml-1_2.js";
export type {
  LSMLBundle,
  LSMLNode,
  LSMLPrimitiveKind,
  LSMLBindObject,
  LSMLAnimateDirective,
  LSMLFill,
  LSMLFillStop,
  LSMLBlendMode,
  LSMLObjectFit,
  LSMLMask,
  LSMLGradientTransform,
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
