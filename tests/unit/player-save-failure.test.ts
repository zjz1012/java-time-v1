import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 存档写不进去时，用户必须知道，而且要有出路。
 *
 * 这一组守的是一个「静默错」：归档写入在退出路径上，界面通常已经切走了。
 * 旧的实现只有一句 `console.warn` —— 配额满了照样正常退出，用户以为存过，
 * 第二天打开发现回到昨天。控制台里的那行字，手机上根本看不见。
 */
const player = readFileSync(join(process.cwd(), 'src/app/PlayerScreen.tsx'), 'utf8')

describe('归档写入失败不再只是日志', () => {
  it('失败会进状态，而不是只 console.warn', () => {
    expect(player).toContain('recordArchiveFailure')
    expect(player).toContain('setArchiveFailure(failure)')
    // 只留日志就还是不告诉人。这条断言守的是「别退回旧写法」。
    expect(player).not.toMatch(/\.catch\(\(cause: unknown\) => \{\s*console\.warn\('\[saves\] 归档写入失败'/)
  })

  it('失败提示在游戏运行时就能看见（不用等退出）', () => {
    // 放进默认收起的存档面板里 = 没提示：写档失败的消息错过就没有第二次机会。
    expect(player).toContain('player__alert')
    expect(player).toMatch(/\{archiveFailure && !exitPrompt \? \(/)
  })

  it('退出前拦一道，四个出口都给出来', () => {
    // 丢进度是不可逆的，所以退出路径必须能：重试、抢救、反悔、明确放弃。
    expect(player).toContain('setExitPrompt(true)')
    expect(player).toContain('重试保存')
    expect(player).toContain('导出这次进度')
    expect(player).toContain('返回游戏')
    expect(player).toContain('放弃并退出')
  })

  it('先问再停，停完再判一次', () => {
    // 两段判缺一不可：
    //   - 已知失败时先问，是为了「返回游戏」这四个字是真的（停了就没游戏可回）；
    //   - 停完再判一次，是为了不拿十分钟前那次失败白拦人一道。
    const leave = player.indexOf('const leaveGame')
    const firstCheck = player.indexOf('if (!force && archiveFailureRef.current)', leave)
    const stop = player.indexOf('runtimeRef.current?.stop()', leave)
    const awaited = player.indexOf('await archiveChain.current', leave)
    const secondCheck = player.indexOf(
      'if (!force && archiveFailureRef.current)',
      firstCheck + 1,
    )

    expect(leave, '找不到 leaveGame').toBeGreaterThan(-1)
    expect(firstCheck).toBeGreaterThan(leave)
    expect(firstCheck).toBeLessThan(stop)
    expect(awaited).toBeGreaterThan(stop)
    expect(secondCheck).toBeGreaterThan(awaited)
  })

  it('游戏已经停了就不再给「返回游戏」', () => {
    // 停完才发现没存上，这时候内核已经关掉，摆一个「返回游戏」是骗人。
    expect(player).toContain('exitStopped')
    expect(player).toMatch(/\{exitStopped \? null : \(/)
  })

  it('紧急导出不经过仓储（仓储正是坏的那个东西）', () => {
    // 走 exportZip 会读出旧档：看起来救回来了，实际少了这一段进度。
    const fn = player.slice(player.indexOf('const exportFailedSnapshot'))
    const body = fn.slice(0, fn.indexOf('}, [fingerprint, displayName])'))
    expect(body).toContain('exportFiles')
    expect(body).not.toContain('exportZip')
  })

  it('空快照写入失败不当成「进度要丢了」', () => {
    // 空快照的语义是删档。删不掉最多让旧档多留一局，不会丢数据 ——
    // 拿它弹「存档没保存成功」，会让每次「本局没存过档」的游戏都吓人一跳。
    expect(player).toContain('archiveFailureOf')
  })
})
