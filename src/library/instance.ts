/**
 * 库仓储的进程内单例。
 *
 * 单独一个文件是为了让「谁持有这个实例」显式可见：库页与运行页必须用**同一个**
 * 实例，否则在库页导入的游戏，运行页可能读不到（两个闭包各自 open 一次库，
 * 虽然最终指向同一份数据，但缓存与连接会分叉）。
 *
 * `createIdbLibraryRepository()` 只建闭包、不打开数据库（首次读写才 open），
 * 所以放在模块顶层不会拖慢首屏，也不会在没有 IndexedDB 的环境里立刻炸。
 */
import { createIdbLibraryRepository } from './store'

export const libraryRepository = createIdbLibraryRepository()
