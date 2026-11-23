import { useEffect, useState } from 'react'

import { MockRuntime, type RuntimeState } from '@/runtime'

type Phase = 'stage0' | 'stage1' | 'stage2plus'

interface ModuleStatus {
  readonly name: string
  readonly detail: string
  readonly phase: Phase
}

/** 阶段 0 的交付状态。数据来自 docs/SOURCE_AUDIT.md 与 docs/provenance/CORE_EVALUATION.md。 */
const MODULES: readonly ModuleStatus[] = [
  { name: '内核来源', detail: 'PluotSorbet @ 46ee3e7（GPL-2.0）+ 本地补丁，源码可重建', phase: 'stage0' },
  { name: '旧版隔离', detail: '第三方网络层与 45 条内置游戏均不迁入', phase: 'stage0' },
  { name: '运行时适配', detail: '契约与 Mock 实现，9 项契约测试覆盖成功/失败/超时', phase: 'stage0' },
  { name: '内核接入', detail: '待核心许可问题决策后开始', phase: 'stage1' },
  { name: '输入系统', detail: '未开始', phase: 'stage2plus' },
  { name: '存档系统', detail: '未开始', phase: 'stage2plus' },
  { name: '产品界面', detail: '未开始', phase: 'stage2plus' },
]

const PHASE_LABEL: Record<Phase, string> = {
  stage0: '已完成',
  stage1: '待决策',
  stage2plus: '未开始',
}

export function App() {
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
        <h2>阶段 0 交付状态</h2>
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
          这里挂载的是 Mock 实现，不加载任何 J2ME 内核。真实内核接入在阶段 1 进行。
        </p>
      </section>

      <footer className="shell__footer">
        <span>内核 GPL-2.0，对应源码见 docs/provenance/SOURCES.md</span>
        <span>·</span>
        <span>关于页在阶段 4 实现</span>
      </footer>
    </main>
  )
}
