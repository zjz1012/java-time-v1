import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const ROOT = fileURLToPath(new URL('.', import.meta.url))

/**
 * 关于页要展示的版本与内核来源，从各自的**正本**里取。
 *
 * 不写成手抄常量：手抄的东西一定会在某次升级后忘记改，而关于页正是
 * 「用户拿来核对分发内容」的那一页 —— 它显示的 commit 与真正拉到的不一致，
 * 比不显示更糟。
 *   - 版本：package.json
 *   - 内核 commit：scripts/fetch-upstream.sh 里钉定的 PIN（构建实际用的是它）
 */
function readVersion(): string {
  const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8')) as { version?: string }
  if (!pkg.version) throw new Error('package.json 没有 version')
  return pkg.version
}

function readKernelPin(): string {
  const script = readFileSync(`${ROOT}scripts/fetch-upstream.sh`, 'utf8')
  const match = /^PIN="([0-9a-f]{40})"$/m.exec(script)
  if (!match?.[1]) {
    throw new Error('scripts/fetch-upstream.sh 里找不到 PIN="<40 位 commit>"，关于页无法展示内核版本')
  }
  return match[1]
}

/**
 * 随包游戏的款数，从来源登记的生成物里数。
 *
 * 关于页要写「自研 6 款 + 开源 98 款」，这个数字必须和真正随包分发的包体一致；
 * 手写在 TSX 里，下次加游戏就只剩「记得改三处」这种运气。
 */
function readPackGames(): { total: number; self: number } {
  const record = JSON.parse(readFileSync(`${ROOT}docs/provenance/games.json`, 'utf8')) as {
    games?: { source?: { kind?: string } }[]
  }
  const games = record.games ?? []
  if (games.length === 0) throw new Error('docs/provenance/games.json 里没有游戏记录')
  return { total: games.length, self: games.filter((game) => game.source?.kind === 'self').length }
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(readVersion()),
    __KERNEL_COMMIT__: JSON.stringify(readKernelPin()),
    __PACK_GAMES__: JSON.stringify(readPackGames()),
  },
  build: {
    target: 'es2022',
    // 内核产物以独立静态资源形式加载，不进 bundle —— 见 docs/decisions/0002-runtime-adapter.md
    assetsInlineLimit: 4096,
  },
  server: {
    port: 5183,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
    },
  },
})
