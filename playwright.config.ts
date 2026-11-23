import { defineConfig, devices } from '@playwright/test'

/**
 * 真内核冒烟测试的配置。
 *
 * 用例需要一个**已经构建好的内核**（`public/kernel/`）和一个测试包
 * （`public/assets/*.jar`），两者都不入库 —— 新克隆的仓库要先跑
 * `scripts/fetch-upstream.sh` + `scripts/build-kernel.sh`。缺产物时用例
 * 会显式 skip 并打印原因，不会静默通过。
 *
 * 走 `vite preview` 而不是 dev server：dev 下 React StrictMode 会把
 * 运行页挂载两次，内核跟着启动两次，两个 iframe 抢同一个容器。
 */
const PORT = 4311
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  // 内核冷启动要十几秒，默认 30s 不够
  timeout: 120_000,
  expect: { timeout: 30_000 },
  // 每个用例都要起一个 JVM + 14MB 内核，并发只会互相拖慢
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // 显式绑 127.0.0.1：默认的 localhost 在部分环境里只解析到 ::1，
    // 而 Playwright 的健康检查走 IPv4，会一直等到超时。
    command: `npm run build && npx vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
