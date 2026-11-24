/**
 * 游戏库的持久化：用户导入的程序包 + 游玩记录。
 *
 * 与存档仓储（`saves/archive`）分两个数据库，理由不是洁癖：
 *   - 存档按**指纹**隔离，库按**id**寻址，两者的主键语义不同；
 *   - 存档库升级时不该连带迁移一份几十 MB 的游戏包；
 *   - 清掉游戏库（用户点「删除导入的游戏」）与清掉存档是两件独立的事。
 *
 * 存 ArrayBuffer 而不是 Blob：与存档仓储保持一致，且 IDB 对 ArrayBuffer 的
 * 支持面更宽（老 Safari 对 Blob 的结构化克隆有过坑）。
 */
import type { ImportedGame, PlayRecord } from './types'

const DB_NAME = 'java-time-library'
const DB_VERSION = 1
const GAMES = 'games'
/** 程序包字节单独一个 store：列表页只读元数据，不能顺手把几十 MB 拖进内存。 */
const BLOBS = 'blobs'
const PLAYS = 'plays'

/** 落盘形状（元数据）。字节在 `BLOBS` 里，按 id 关联。 */
interface StoredGame {
  readonly id: string
  readonly title: string
  readonly subtitle: string
  readonly category: string
  readonly author: string
  readonly bytes: number
  readonly fingerprint: string
  readonly importedAt: number
}

interface StoredBlob {
  readonly id: string
  readonly blob: ArrayBuffer
}

/** 导入一个游戏时要提供的东西。 */
export interface ImportDraft {
  readonly id: string
  readonly title: string
  readonly subtitle: string
  /** 分类。导入的游戏固定是 `imported`（伪分类），见 `types.ts` */
  readonly category: string
  readonly author: string
  readonly fingerprint: string
  readonly importedAt: number
  readonly bytes: Uint8Array
}

export interface LibraryRepository {
  /** 已导入的游戏（不含字节，列表页不需要把几 MB 读进内存）。 */
  listImported(): Promise<ImportedGame[]>
  /** 取某个导入游戏的字节，启动时用。 */
  readBytes(id: string): Promise<Uint8Array | null>
  /** 写入或覆盖。同一个 id 再次写入就是「换了包」。 */
  saveImported(draft: ImportDraft): Promise<void>
  removeImported(id: string): Promise<void>
  listPlays(): Promise<PlayRecord[]>
  /** 记一次游玩。同一款只保留最后一次时间，次数累加。 */
  recordPlay(gameId: string, at: number): Promise<void>
}

function toEntry(record: StoredGame): ImportedGame {
  return {
    id: record.id,
    title: record.title,
    subtitle: record.subtitle,
    category: record.category,
    author: record.author,
    bytes: record.bytes,
    fingerprint: record.fingerprint,
    importedAt: record.importedAt,
    source: 'imported',
  }
}

export function createIdbLibraryRepository(): LibraryRepository {
  let opening: Promise<IDBDatabase> | null = null

  function openDb(): Promise<IDBDatabase> {
    if (opening) return opening
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('当前环境不支持 IndexedDB，无法保存导入的游戏'))
        return
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(GAMES)) {
          db.createObjectStore(GAMES, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(BLOBS)) {
          db.createObjectStore(BLOBS, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(PLAYS)) {
          db.createObjectStore(PLAYS, { keyPath: 'gameId' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('打开游戏库失败'))
      request.onblocked = () => reject(new Error('游戏库被其他标签页占用，请关闭后重试'))
    })
    // 失败不缓存：用户关掉占用它的标签页后应该能重试，而不是被迫刷新。
    opening.catch(() => {
      opening = null
    })
    return opening
  }

  /**
   * 跑一个事务。
   *
   * 允许一次开多个 store：写一个游戏要同时落元数据与字节，分两个事务的话
   * 中间崩溃会留下「有元数据但没字节」的条目 —— 列表里显示得出来，点进去
   * 却读不到数据。同一个事务要么全成要么全不成。
   */
  function run<T>(
    stores: string | readonly string[],
    mode: IDBTransactionMode,
    operation: (tx: IDBTransaction) => IDBRequest<T>,
  ): Promise<T> {
    return openDb().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const tx = db.transaction(stores as string | string[], mode)
          const request = operation(tx)
          let result: T | undefined
          request.onsuccess = () => {
            result = request.result
          }
          request.onerror = () => reject(request.error ?? new Error('游戏库操作失败'))
          // 等事务提交而不是等 request：request 成功时数据还没落盘。
          tx.oncomplete = () => resolve(result as T)
          tx.onabort = () => reject(tx.error ?? new Error('游戏库事务被中止'))
        }),
    )
  }

  return {
    listImported() {
      // 只碰 `GAMES`：元数据里没有字节，所以这个查询与包的大小无关。
      return run<StoredGame[]>(GAMES, 'readonly', (tx) =>
        tx.objectStore(GAMES).getAll() as IDBRequest<StoredGame[]>,
      ).then((records) => records.map(toEntry).sort((a, b) => b.importedAt - a.importedAt))
    },

    readBytes(id) {
      return run<StoredBlob | undefined>(BLOBS, 'readonly', (tx) =>
        tx.objectStore(BLOBS).get(id) as IDBRequest<StoredBlob | undefined>,
      ).then((record) => (record ? new Uint8Array(record.blob) : null))
    },

    saveImported(draft) {
      const meta: StoredGame = {
        id: draft.id,
        title: draft.title,
        subtitle: draft.subtitle,
        category: draft.category,
        author: draft.author,
        bytes: draft.bytes.byteLength,
        fingerprint: draft.fingerprint,
        importedAt: draft.importedAt,
      }
      return run([GAMES, BLOBS], 'readwrite', (tx) => {
        tx.objectStore(GAMES).put(meta)
        // slice() 存独立副本：入参可能是大 buffer 的视图，
        // 直接存 .buffer 会把无关字节一起写进去。
        const blob: StoredBlob = { id: draft.id, blob: draft.bytes.slice().buffer as ArrayBuffer }
        return tx.objectStore(BLOBS).put(blob) as IDBRequest<IDBValidKey>
      }).then(() => undefined)
    },

    removeImported(id) {
      return run([GAMES, BLOBS], 'readwrite', (tx) => {
        tx.objectStore(GAMES).delete(id)
        return tx.objectStore(BLOBS).delete(id) as IDBRequest<undefined>
      }).then(() => undefined)
    },

    listPlays() {
      return run<PlayRecord[]>(PLAYS, 'readonly', (tx) =>
        tx.objectStore(PLAYS).getAll() as IDBRequest<PlayRecord[]>,
      )
    },

    recordPlay(gameId, at) {
      // 读-改-写必须同一个事务：两个标签页同时记一次游玩时，
      // 分成两个事务会让后写的覆盖先写的次数。
      return openDb().then(
        (db) =>
          new Promise<void>((resolve, reject) => {
            const tx = db.transaction(PLAYS, 'readwrite')
            const store = tx.objectStore(PLAYS)
            const request = store.get(gameId)
            request.onsuccess = () => {
              const previous = request.result as PlayRecord | undefined
              store.put({
                gameId,
                lastPlayedAt: at,
                plays: (previous?.plays ?? 0) + 1,
              })
            }
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error ?? new Error('记录游玩失败'))
            tx.onabort = () => reject(tx.error ?? new Error('游戏库事务被中止'))
          }),
      )
    },
  }
}

/**
 * 内存实现。单测与「没有 IndexedDB 的环境」都用它 —— 筛选与去重逻辑
 * 不该因为测试环境缺能力就整块跳过。
 */
export function createMemoryLibraryRepository(): LibraryRepository {
  const games = new Map<string, StoredGame>()
  const blobs = new Map<string, ArrayBuffer>()
  const plays = new Map<string, PlayRecord>()

  return {
    listImported: () =>
      Promise.resolve([...games.values()].map(toEntry).sort((a, b) => b.importedAt - a.importedAt)),
    readBytes: (id) => {
      const blob = blobs.get(id)
      return Promise.resolve(blob ? new Uint8Array(blob) : null)
    },
    saveImported: (draft) => {
      games.set(draft.id, {
        id: draft.id,
        title: draft.title,
        subtitle: draft.subtitle,
        category: draft.category,
        author: draft.author,
        bytes: draft.bytes.byteLength,
        fingerprint: draft.fingerprint,
        importedAt: draft.importedAt,
      })
      blobs.set(draft.id, draft.bytes.slice().buffer as ArrayBuffer)
      return Promise.resolve()
    },
    removeImported: (id) => {
      games.delete(id)
      blobs.delete(id)
      return Promise.resolve()
    },
    listPlays: () => Promise.resolve([...plays.values()]),
    recordPlay: (gameId, at) => {
      const previous = plays.get(gameId)
      plays.set(gameId, { gameId, lastPlayedAt: at, plays: (previous?.plays ?? 0) + 1 })
      return Promise.resolve()
    },
  }
}
