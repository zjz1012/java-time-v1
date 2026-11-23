import { useEffect, useState } from 'react'

import { MockRuntime, type RuntimeState } from '@/runtime'
import { PlayerScreen } from './PlayerScreen'

type Phase = 'stage0' | 'stage1' | 'stage2plus'

interface ModuleStatus {
  readonly name: string
  readonly detail: string
  readonly phase: Phase
}

/** 阶段状态。数据来自 docs/SOURCE_AUDIT.md 与 docs/provenance/CORE_EVALUATION.md。 */
const MODULES: readonly ModuleStatus[] = [
  { name: '内核来源', detail: 'PluotSorbet @ 46ee3e7（GPL-2.0）+ 本地补丁，源码可重建', phase: 'stage0' },
  { name: '旧版隔离', detail: '第三方网络层与 45 条内置游戏均不迁入', phase: 'stage0' },
  { name: '运行时适配', detail: '契约与 Mock 实现，12 项契约测试覆盖成功/失败/超时', phase: 'stage0' },
  { name: '内核接入', detail: '宿主页装配 + 适配器，自编 MIDlet 已跑通启动与出画', phase: 'stage1' },
  { name: '输入系统', detail: '键位映射与虚拟键区；多点同按、失焦抬键已覆盖', phase: 'stage1' },
  { name: '存档系统', detail: '未开始', phase: 'stage2plus' },
  { name: '产品界面', detail: '未开始', phase: 'stage2plus' },
]

const PHASE_LABEL: Record<Phase, string> = {
  stage0: '已完成',
  stage1: '进行中',
  stage2plus: '未开始',
}

/**
 * 阶段 1 没有游戏库，运行页由一个显式参数唤起：
 *
 *   /?jar=/assets/sokoban.jar&name=推箱子
 *
 * 这样做的目的是**让「内核能跑」这件事可以复现**，而不是先做一层列表再回头补运行页。
 * 参数只在开发与验证时使用，阶段 2 由游戏库替代；它不改变任何默认行为
 * （不带参数时显示的就是状态页）。
 */
export function App() {
  const params = new URLSearchParams(location.search)
  const jarUrl = params.get('jar')

  if (jarUrl) {
    return <PlayerScreen jarUrl={jarUrl} displayName={params.get('name') ?? '未命名程序'} />
  }
  return <StatusScreen />
}

function StatusScreen() {
  const [state, setState] = useState<RuntimeState>('idle')

  useEffect(() => {
    const runtime = new MockRuntime()
    const off = runtime.on('statechange', (e) => setState(e.current))
    void runtime.load({
      fingerprint: 'demo',
      displayName: 'demo',
      bytes: new Uint8Array([0]),
    })
    return () => {
      off()
      void runtime.dispose()
    }
  }, [])

  return (
    <main className="shell">
      <header className="shell__header">
        <h1>JAVA时光</h1>
        <p className="shell__subtitle">V1.0 独立重构 · 工程骨架</p>
      </header>

      <section className="shell__card">
        <h2>阶段交付状态</h2>
        <ul className="status-list">
          {MODULES.map((m) => (
            <li key={m.name} className={`status-list__item status-list__item--${m.phase}`}>
              <span className="status-list__name">{m.name}</span>
              <span className="status-list__detail">{m.detail}</span>
              <span className="status-list__badge">{PHASE_LABEL[m.phase]}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="shell__card">
        <h2>运行时自检</h2>
        <p>
          适配层当前状态：<code>{state}</code>
        </p>
        <p className="shell__hint">
          这一页挂的是 Mock 实现，不加载任何 J2ME 内核。要跑真实内核，用
          <code>?jar=</code> 指定一个程序包，例如 <code>/?jar=/assets/sokoban.jar</code>。
        </p>
      </section>

      <footer className="shell__footer">
        <p>内核 GPL-2.0 · 自有 GPL-2.0-or-later</p>
      </footer>
    </main>
  )
}
