import { describe, expect, it } from 'vitest'

import { RuntimeFailure, describeErrorCode, describeFailure } from '@/runtime/errors'

/**
 * 错误文案的分寸。
 *
 * 内核抛出的原始信息不直接展示给用户（既不能告诉他做什么，也不该出现在界面上），
 * 但有两个例外必须透传：存档恢复失败（用户能做的事取决于原因）与内核缺 native
 * 实现（用户该换一款游戏，而不是去查自己的浏览器）。
 */
describe('错误文案', () => {
  it('缺 native 实现时带上具体缺什么', () => {
    const text = describeErrorCode(
      'UNSUPPORTED_CAPABILITY',
      '这款游戏用到了列表选择控件（ChoiceGroup），内核没有实现它',
    )
    expect(text).toContain('列表选择控件')
    expect(text).toContain('不支持这个功能')
  })

  it('存档恢复失败带上原因', () => {
    expect(describeErrorCode('SAVE_RESTORE_FAILED', '存储库不可写')).toContain('存储库不可写')
  })

  it('其他码不透传原始信息', () => {
    // 内核的原文对用户没有可操作性，漏出去只是噪音。
    const text = describeErrorCode('INTERNAL', 'java.lang.NullPointerException at Foo.bar')
    expect(text).not.toContain('NullPointerException')
  })

  it('没有 detail 时退回基础文案', () => {
    expect(describeErrorCode('UNSUPPORTED_CAPABILITY')).toBe('当前运行组件不支持这个功能。')
  })

  it('describeFailure 走同一条路，不会出现两种说法', () => {
    const failure = new RuntimeFailure('UNSUPPORTED_CAPABILITY', '这款游戏用到了滚动字幕（Ticker），内核没有实现它')
    expect(describeFailure(failure)).toBe(describeErrorCode(failure.code, failure.message))
    expect(describeFailure(failure)).toContain('滚动字幕')
  })
})
