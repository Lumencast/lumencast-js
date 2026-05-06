// Public surface of @lumencast/archive.

export {
  packArchive,
  unpackArchive,
  isArchive,
  LSMLZError,
  LSMLZ_MEDIA_TYPE,
  LSMLZ_FILE_EXTENSION,
  type ArchiveContents,
  type PackInput,
  type LSMLZErrorCode,
} from "./archive.js";

export {
  runCase,
  runCaseFile,
  type CaseFile,
  type CaseInput,
  type CaseExpect,
  type SingleCase,
  type CaseResult,
} from "./conformance.js";
