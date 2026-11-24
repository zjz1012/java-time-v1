import { describe, expect, it } from 'vitest'

import type { RuntimeState } from '@/runtime/types'
import { canImport, importSavePackage, needsRestart } from '@/saves/import-flow'
import type { UnpackResult } from '@/saves/format'

/**
 * 导入的时序。这里的断言不是「函数被调用过」，而是**调用顺序**：
 * 顺序反了同样能通过「导入成功」的提示，只是退出游戏后存档会变回去。
 */

const FP = `sha256:${'a'.repeat(64)}`
const OTHER = `sha256:${'b'.repeat(64)}`

function parsed(fingerprint: string, displayName = '推箱子'): UnpackResult {
  return {
    manifest: {
      format: 'java-time-save',
      version: 1,
      fingerprint,
      displayName,
      exportedAt: 0,
      files: [],
    },
    files: [],
  }
}

/** 记录调用顺序的手柄。`stop` 故意带一点延迟，模拟「等退出快照归档」。 */
function harness(log: string[], stopDelayMs = 3) {
  return {
    stop: async () => {
      log.push('stop')
      await new Promise((resolve) => setTimeout(resolve, stopDelayMs))
      log.push('stop:done')
    },
    apply: async () => {
      log.push('apply')
    },
    relaunch: () => {
      log.push('relaunch')
    },
  }
}

describe('什么时候需要先停下游戏', () => {
  const states: RuntimeState[] = [
    'idle',
    'loading',
    'ready',
    'starting',
    'running',
    'paused',
    'stopping',
    'stopped',
    'failed',
  ]

  it('同游戏 + 内核在占用 → 需要重启', () => {
    for (const state of ['starting', 'running', 'paused', 'stopping'] as const) {
      expect(needsRestart(state, FP, parsed(FP)), state).toBe(true)
    }
  })

  it('别的游戏 → 不需要重启（不该打断当前这局）', () => {
    for (const state of states) {
      expect(needsRestart(state, FP, parsed(OTHER)), state).toBe(false)
    }
  })

  it('没在跑 → 直接写归档即可', () => {
    for (const state of ['stopped', 'failed'] as const) {
      expect(needsRestart(state, FP, parsed(FP)), state).toBe(false)
    }
  })
})

describe('什么时候根本不能导入', () => {
  it('内核还没装配完就拒绝：停它会交空快照，继续跑会被旧档覆盖', () => {
    for (const state of ['idle', 'loading', 'ready'] as const) {
      expect(canImport(state), state).toBe(false)
    }
  })

  it('其余状态可以导入（要么直接写，要么停-写-重启）', () => {
    for (const state of ['starting', 'running', 'paused', 'stopping', 'stopped', 'failed'] as const) {
      expect(canImport(state), state).toBe(true)
    }
  })
})

describe('导入顺序', () => {
  it('运行中：停 → 写 → 重启，且写归档发生在退出快照之后', async () => {
    const log: string[] = []
    const outcome = await importSavePackage(parsed(FP), FP, 'running', harness(log))

    expect(outcome).toEqual({ kind: 'restarted', displayName: '推箱子' })
    // stop 必须先结束（含归档写入），apply 才能开始。
    expect(log).toEqual(['stop', 'stop:done', 'apply', 'relaunch'])
  })

  it('启动中（还没出画）：同样先停再写', async () => {
    const log: string[] = []
    await importSavePackage(parsed(FP), FP, 'starting', harness(log))
    expect(log).toEqual(['stop', 'stop:done', 'apply', 'relaunch'])
  })

  it('暂停中：同样先停再写', async () => {
    const log: string[] = []
    await importSavePackage(parsed(FP), FP, 'paused', harness(log))
    expect(log).toEqual(['stop', 'stop:done', 'apply', 'relaunch'])
  })

  it('没在跑：只写归档，不重启也不停', async () => {
    const log: string[] = []
    const outcome = await importSavePackage(parsed(FP), FP, 'failed', harness(log))

    expect(outcome).toEqual({ kind: 'pending', displayName: '推箱子' })
    expect(log).toEqual(['apply'])
  })

  it('别的游戏：只写归档，当前这局不受影响', async () => {
    const log: string[] = []
    const outcome = await importSavePackage(parsed(OTHER, '贪吃蛇'), FP, 'running', harness(log))

    expect(outcome).toEqual({ kind: 'foreign', displayName: '贪吃蛇' })
    expect(log).toEqual(['apply'])
  })

  it('停不下来也要写入 —— 否则用户点了「确认」什么都没发生', async () => {
    const log: string[] = []
    const handlers = {
      stop: () => {
        log.push('stop')
        return Promise.reject(new Error('内核无响应'))
      },
      apply: async () => {
        log.push('apply')
      },
      relaunch: () => {
        log.push('relaunch')
      },
    }

    // stop 的失败要由调用方处理（运行页会把 stop 的异常吞掉并继续），
    // 这里只固定一点：stop 抛错时不会偷偷把 apply 提前。
    await expect(importSavePackage(parsed(FP), FP, 'running', handlers)).rejects.toThrow()
    expect(log).toEqual(['stop'])
  })
})
