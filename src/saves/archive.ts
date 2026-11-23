/**
 * 存档归档：按程序包指纹隔离的持久化仓储。
 *
 * 这是存档的**真相来源**。内核的文件系统只在一次运行期间持有它，
 * 启动前灌进去、退出时读出来（原因见 ADR 0005：内核的持久化不可靠，
 * 而且它的 RMS 目录不区分游戏）。
 *
 * 存储用 IndexedDB 而不是 localStorage：存档可能是 MB 级，
 * localStorage 有 5MB 硬限制且同步阻塞主线程（ADR 0001 已定）。
 */
import type { SaveFile } from '@/runtime/types'

const DB_NAME = 'java-time-saves'
const DB_VERSION = 1
const STORE = 'snapshots'

export interface ArchivedSave {
  /** 程序包内容指纹，隔离键 */
  readonly fingerprint: string
  /** 仅用于展示，不参与身份判定 */
  readonly displayName: string
  /** 最后一次写入时间（毫秒时间戳） */
  readonly updatedAt: number
  readonly files: readonly SaveFile[]
}

export interface SaveRepository {
  read(fingerprint: string): Promise<ArchivedSave | null>
  write(save: ArchivedSave): Promise<void>
  remove(fingerprint: string): Promise<void>
  list(): Promise<ArchivedSave[]>
}

/** IDB 里能直接结构化克隆的类型有限，字节统一按 ArrayBuffer 存。 */
interface StoredRecord {
  readonly fingerprint: string
  readonly displayName: string
  readonly updatedAt: number
  readonly files: ReadonlyArray<{ path: string; bytes: ArrayBuffer }>
}

function toStored(save: ArchivedSave): StoredRecord {
  return {
    fingerprint: save.fingerprint,
    displayName: save.displayName,
    updatedAt: save.updatedAt,
    files: save.files.map((file) => ({
      path: file.path,
      // slice() 保证存的是独立副本：Uint8Array 可能是大 buffer 的视图，
      // 直接存 .buffer 会把无关字节一起写进去，读回来就多了数据。
      bytes: file.bytes.slice().buffer as ArrayBuffer,
    })),
  }
}

function fromStored(record: StoredRecord): ArchivedSave {
  return {
    fingerprint: record.fingerprint,
    displayName: record.displayName,
    updatedAt: record.updatedAt,
    files: record.files.map((file) => ({
      path: file.path,
      bytes: new Uint8Array(file.bytes),
    })),
  }
}

export function createIdbRepository(): SaveRepository {
  let opening: Promise<IDBDatabase> | null = null

  function openDb(): Promise<IDBDatabase> {
    if (opening) return opening
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('当前环境不支持 IndexedDB，无法保存存档'))
        return
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'fingerprint' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('打开存档库失败'))
      request.onblocked = () => reject(new Error('存档库被其他标签页占用，请关闭后重试'))
    })
    return opening
  }

  function run<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    return openDb().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const tx = db.transaction(STORE, mode)
          const request = operation(tx.objectStore(STORE))
          let result: T | undefined
          request.onsuccess = () => {
            result = request.result
          }
          request.onerror = () => reject(request.error ?? new Error('存档操作失败'))
          // 必须等事务提交，不是等 request 成功：request 成功时数据还没落盘，
          // 这时页面被关掉就白写了。
          tx.oncomplete = () => resolve(result as T)
          tx.onabort = () => reject(tx.error ?? new Error('存档事务被中止'))
        }),
    )
  }

  return {
    read(fingerprint) {
      return run<StoredRecord | undefined>('readonly', (store) => store.get(fingerprint)).then(
        (record) => (record ? fromStored(record) : null),
      )
    },
    write(save) {
      return run('readwrite', (store) => store.put(toStored(save))).then(() => undefined)
    },
    remove(fingerprint) {
      return run('readwrite', (store) => store.delete(fingerprint)).then(() => undefined)
    },
    list() {
      return run<StoredRecord[]>('readonly', (store) => store.getAll()).then((records) =>
        records.map(fromStored),
      )
    },
  }
}

/**
 * 内存实现。给单测用 —— jsdom 没有 IndexedDB，而仓储的行为（隔离、覆盖、
 * 删除）恰恰是最该被断言的部分，不能因为环境缺能力就整块不测。
 */
export function createMemoryRepository(): SaveRepository {
  const store = new Map<string, ArchivedSave>()

  return {
    read: (fingerprint) => Promise.resolve(store.get(fingerprint) ?? null),
    write: (save) => {
      store.set(save.fingerprint, save)
      return Promise.resolve()
    },
    remove: (fingerprint) => {
      store.delete(fingerprint)
      return Promise.resolve()
    },
    list: () => Promise.resolve([...store.values()]),
  }
}
