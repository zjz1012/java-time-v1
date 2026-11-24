/**
 * 存档服务的单例。
 *
 * 两个页面都要用它：运行页写档（每局都在写）、库页读「本机有多少份存档」
 * 并清理。各建一个实例不会出错 —— `createIdbRepository` 只建闭包、不开库 ——
 * 但那样「清理」与「写档」就是两条独立的连接，容易出现「清理完这一份、
 * 运行页手里还攥着旧快照」的时序问题。共用一份更接近事实：仓库只有一个。
 *
 * 放模块顶层不会拖慢首屏：首次读写才 open 数据库。
 */
import { createIdbRepository } from './archive'
import { createSaveService } from './service'

export const saveService = createSaveService(createIdbRepository())
