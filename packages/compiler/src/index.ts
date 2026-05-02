// Public surface of @lumencast/compiler.

export { compileBundle, type CompileOptions } from "./compile.js";
export { canonicalize, hashBundle, ZERO_HASH } from "./canonicalize.js";
export type {
  LSMLBundle,
  LSMLNode,
  LSMLPrimitiveKind,
  LSMLBindObject,
  LSMLAnimateDirective,
  LSMLStack,
  LSMLGrid,
  LSMLFrame,
  LSMLText,
  LSMLImage,
  LSMLShape,
  LSMLMedia,
  LSMLRepeat,
  LSMLOperatorInput,
} from "./lsml-types.js";
