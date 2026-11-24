import { LIBRARY_HASH } from '@/library'

/**
 * 关于页。
 *
 * 这一页不是装饰。分发物里包含着别人的 GPL 代码与别人授权的游戏，
 * 而 GPL 与 MIT 都要求「分发时给出许可原文、并说明来源」——
 * 源码在仓库里、许可见 LICENSE，但这些如果产品里没有入口，
 * 用户拿到的就是一个说不清自己是什么的网页。
 *
 * 所以这一页只回答四个问题：
 *   1. 你跑的到底是什么（内核 + 上游 commit）
 *   2. 各部分分别是谁的、什么许可
 *   3. 许可原文在哪（`public/licenses/`，逐字节等于仓库正本）
 *   4. 源码怎么拿
 *
 * 数字（版本、commit、款数）全部来自构建期注入，不在 JSX 里手抄 ——
 * 见 `vite.config.ts` 的 `define` 与 `src/globals.d.ts`。
 */

/** 本应用自有代码的仓库地址。改仓库时这里也要改，`about-structure` 测试会盯着。 */
const REPO_URL = 'https://github.com/zjz1012/java-time-v1'

/** 内核上游。commit 是钉定的那一个（`scripts/fetch-upstream.sh` 的 PIN）。 */
const KERNEL_URL = 'https://github.com/mozilla/pluotsorbet'

const LICENSE_FILES = [
  { name: 'GPL-2.0.txt', label: 'GNU GPL v2.0 全文', note: '内核与自研游戏适用' },
  { name: 'MIT.txt', label: 'MIT 全文与三份版权行', note: '随包开源小游戏适用' },
  {
    name: 'THIRD_PARTY_NOTICES.txt',
    label: '第三方组件声明',
    note: '逐组件来源、许可与源码获取方式',
  },
] as const

export function AboutScreen() {
  const openSourceGames = __PACK_GAMES__.total - __PACK_GAMES__.self

  return (
    <main className="about">
      <header className="about__head">
        <h1 className="about__title">关于</h1>
        <p className="about__sub">
          JAVA时光 · <span className="about__mono">v{__APP_VERSION__}</span>
        </p>
      </header>

      <section className="about__section">
        <h2 className="about__h2">这是什么</h2>
        <p className="about__p">
          在浏览器里直接跑 Java ME（J2ME）小游戏。内核是 Mozilla 的 PluotSorbet，
          编译成 WebAssembly；随包 {__PACK_GAMES__.total} 款游戏，也可以自己导入
          <code>.jar</code>。
        </p>
        <p className="about__p">
          不需要安装、不需要账号。存档只写在本机浏览器的 IndexedDB 里，
          <strong>不会上传到任何服务器</strong>；关掉浏览器之前导出一次，换设备才带得走。
        </p>
      </section>

      <section className="about__section">
        <h2 className="about__h2">许可分层</h2>
        <p className="about__p">
          这个页面里不同部分的版权与许可是分开的，不存在「整个站一个许可」这回事：
        </p>
        <dl className="about__licenses">
          <div className="about__license">
            <dt>本应用自有代码</dt>
            <dd>
              GPL-2.0-or-later · 可任选 GPLv2 或更新版本使用与再分发
              <span className="about__hint">（界面、存档、路由、构建与测试脚本）</span>
            </dd>
          </div>
          <div className="about__license">
            <dt>内核四件产物</dt>
            <dd>
              GPL-2.0 · <strong>非</strong> “or later”
              <span className="about__hint">
                （PluotSorbet 的衍生编译产物，Boehm GC 为宽松许可）
              </span>
            </dd>
          </div>
          <div className="about__license">
            <dt>随包自研游戏 {__PACK_GAMES__.self} 款</dt>
            <dd>
              GPL-2.0-or-later · 完整源码在仓库 <code>midlets/src/</code>
              <span className="about__hint">（可重编译，与随包产物逐字节比对过）</span>
            </dd>
          </div>
          <div className="about__license">
            <dt>随包开源小游戏 {openSourceGames} 款</dt>
            <dd>
              MIT · 各自版权人保留，逐款登记了上游 commit
              <span className="about__hint">
                （与本仓库代码构成聚合关系，不形成衍生作品）
              </span>
            </dd>
          </div>
          <div className="about__license">
            <dt>界面依赖</dt>
            <dd>
              MIT / Apache-2.0
              <span className="about__hint">（React、Vite 等，构建期依赖不进分发包）</span>
            </dd>
          </div>
        </dl>
      </section>

      <section className="about__section">
        <h2 className="about__h2">源码与许可原文</h2>
        <p className="about__p">
          内核构建自 <span className="about__mono">{KERNEL_URL}</span> 的固定 commit
          <span className="about__mono"> {__KERNEL_COMMIT__}</span>；
          对本仓库的修改与完整构建方法（<code>scripts/fixup-upstream.py</code>、{' '}
          <code>scripts/build-kernel.sh</code>）随源码一并提供。
        </p>
        <p className="about__p">
          本应用源码：<a className="about__link" href={REPO_URL}>{REPO_URL}</a>
        </p>
        <ul className="about__files">
          {LICENSE_FILES.map((file) => (
            <li key={file.name}>
              <a className="about__link" href={`licenses/${file.name}`}>
                {file.label}
              </a>
              <span className="about__hint">{file.note}</span>
            </li>
          ))}
        </ul>
        <p className="about__note">
          这些文件随包分发，且与仓库正本逐字节一致（<code>npm run check:licenses</code> 会核对）。
        </p>
      </section>

      <section className="about__section">
        <h2 className="about__h2">不含什么</h2>
        <p className="about__p">
          不含 ROM、BIOS、字体或商业素材，也不含任何需要付费才能使用的游戏。
          你自己导入的 <code>.jar</code> 只在本机浏览器里运行，我们没有能力也没有
          打算把它传走 —— 这个站没有后端。
        </p>
      </section>

      <footer className="about__foot">
        <a className="about__link" href={LIBRARY_HASH}>
          回到游戏库
        </a>
      </footer>
    </main>
  )
}
