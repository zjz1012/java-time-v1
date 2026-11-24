/**
 * 游戏库层。
 *
 * 对外只暴露「取库、搜、启动、导入」四件事，内部结构（清单是不是生成的、
 * 导入的存哪）留给实现。
 */
export { CATEGORIES, BUILTIN_BY_ID, BUILTIN_GAMES } from './catalog'
export {
  GAME_DIR,
  builtinEntries,
  findBuiltin,
  jarPath,
  loadLibrary,
  resolveLaunch,
  shotPath,
  type GameLaunch,
} from './entries'
export {
  countByCategory,
  matchesQuery,
  queryLibrary,
  recentGames,
} from './filter'
export {
  ImportError,
  MAX_IMPORT_BYTES,
  assertNoConflict,
  importedId,
  parseJarFile,
  titleFromFilename,
  type ImportErrorCode,
  type ParsedImport,
} from './import'
export { ABOUT_HASH, LIBRARY_HASH, currentRoute, parseRoute, playHash, type Route } from './routes'
export {
  createIdbLibraryRepository,
  createMemoryLibraryRepository,
  type ImportDraft,
  type LibraryRepository,
} from './store'
export {
  ALL_CATEGORY,
  IMPORTED_CATEGORY,
  type BuiltinGame,
  type Category,
  type GameEntry,
  type GameSource,
  type ImportedGame,
  type LibraryQuery,
  type PlayRecord,
} from './types'
