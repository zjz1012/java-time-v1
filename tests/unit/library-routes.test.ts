import { describe, expect, it } from 'vitest'

import { LIBRARY_HASH, parseRoute, playHash } from '@/library/routes'

describe('hash 路由', () => {
  it('空 hash 与 #/ 都是库页', () => {
    expect(parseRoute('')).toEqual({ name: 'library' })
    expect(parseRoute('#')).toEqual({ name: 'library' })
    expect(parseRoute('#/')).toEqual({ name: 'library' })
    expect(parseRoute(LIBRARY_HASH)).toEqual({ name: 'library' })
  })

  it('拼出来的运行页 hash 一定解析得回去', () => {
    // 生成与解析成对维护的意义就在这里：两边格式不一致时，
    // 症状是「点了游戏打不开」，而不是某个函数报错。
    for (const id of ['snake', 'g2048', 'user-0123456789abcdef']) {
      expect(parseRoute(playHash(id))).toEqual({ name: 'play', gameId: id })
    }
  })

  it('id 里的特殊字符经编码后仍能还原', () => {
    const id = 'user-abc_DEF-123'
    expect(parseRoute(playHash(id))).toEqual({ name: 'play', gameId: id })
  })

  it.each([
    ['未知前缀', '#/play'],
    ['只有前缀', '#/play/'],
    ['多余层级', '#/play/snake/extra'],
    ['不是 play', '#/about'],
    ['裸 id', '#/snake'],
  ])('%s 一律回库页', (_label, hash) => {
    expect(parseRoute(hash)).toEqual({ name: 'library' })
  })

  it('半个百分号编码不会抛错，而是回库页', () => {
    // decodeURIComponent('%E4') 会抛 URIError。让它冒出去就是白屏。
    expect(parseRoute('#/play/%E4')).toEqual({ name: 'library' })
  })

  it('过长的 id 被拒', () => {
    expect(parseRoute(playHash('a'.repeat(81)))).toEqual({ name: 'library' })
    expect(parseRoute(playHash('a'.repeat(80)))).toEqual({ name: 'play', gameId: 'a'.repeat(80) })
  })

  it('带查询串的 hash 仍按路径解析', () => {
    expect(parseRoute('#/play/snake?x=1')).toEqual({ name: 'play', gameId: 'snake' })
  })
})
