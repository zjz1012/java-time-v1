import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'

import {
  ABOUT_HASH,
  BUILTIN_GAMES,
  CATEGORIES,
  IMPORTED_CATEGORY,
  ImportError,
  assertNoConflict,
  builtinEntries,
  countByCategory,
  loadLibrary,
  parseJarFile,
  playHash,
  queryLibrary,
  recentGames,
  shotPath,
  type GameEntry,
  type LibraryQuery,
  type PlayRecord,
} from '@/library'
import { libraryRepository } from '@/library/instance'
import { saveService } from '@/saves/instance'

/**
 * 库页。
 *
 * 只做三件事：把库读出来、按用户的选择筛、把卡片画出来。筛选与排序在
 * `library/filter.ts` 里是纯函数，所以「为什么这款没出现」不需要靠翻界面查。
 */

const ALL_LABEL = '全部'

export function LibraryScreen() {
  /**
   * 初值直接用内置清单：104 条在编译期就在包里了，等 IndexedDB 打开再渲染
   * 会先闪一下空白。导入的游戏随后并进来。
   */
  const [games, setGames] = useState<readonly GameEntry[]>(builtinEntries)
  const [plays, setPlays] = useState<readonly PlayRecord[]>([])
  const [storageError, setStorageError] = useState<string | null>(null)

  const [query, setQuery] = useState<LibraryQuery>({ text: '', category: null })
  const [note, setNote] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  /*
   * 存档份数。
   *
   * `null` 表示「还没读到」或「读不到」，与「0 份」必须分开：
   * 读不到却显示 0，用户会以为存档没了，然后去别的地方找原因。
   */
  const [saveCount, setSaveCount] = useState<number | null>(null)
  const [clearArmed, setClearArmed] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [dataNote, setDataNote] = useState<string | null>(null)

  const refreshSaves = useCallback(async () => {
    try {
      const saves = await saveService.list()
      setSaveCount(saves.length)
    } catch {
      setSaveCount(null)
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      // 两个读并行：库与游玩记录互不依赖，串行只是让首屏白等一倍时间。
      const [all, records] = await Promise.all([
        loadLibrary(libraryRepository),
        libraryRepository.listPlays(),
      ])
      setGames(all)
      setPlays(records)
      setStorageError(null)
    } catch (cause) {
      // 读不到导入的游戏不该让整页打不开：内置的 104 款照样能玩。
      setStorageError(cause instanceof Error ? cause.message : '读取本地库失败')
    }
  }, [])

  useEffect(() => {
    void refresh()
    // 存档份数与库一起读：这两块都在「本机数据」里，分开转圈只会让一处先空着。
    void refreshSaves()
  }, [refresh, refreshSaves])

  const visible = useMemo(() => queryLibrary(games, query), [games, query])
  const recent = useMemo(() => recentGames(games, plays), [games, plays])

  const importedCount = useMemo(
    () => games.filter((game) => game.source === 'imported').length,
    [games],
  )

  const handleImport = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      // 清空 value：同一个文件连选两次也要能再次触发 change。
      event.target.value = ''
      if (!file) return

      setImporting(true)
      setNote(null)
      try {
        const existing = games.filter((game) => game.source === 'imported')
        const parsed = await parseJarFile(file, existing.map((game) => game.id))
        assertNoConflict(parsed, existing)
        await libraryRepository.saveImported(parsed)
        await refresh()
        setNote(
          parsed.replacesExisting
            ? `已更新「${parsed.title}」`
            : `已导入「${parsed.title}」，可以在「我导入的」里找到它`,
        )
        // 导入完直接切到「我导入的」：不然新包藏在 104 张卡片后面，
        // 用户会以为导入失败。
        setQuery((current) => ({ ...current, category: IMPORTED_CATEGORY }))
      } catch (cause) {
        setNote(
          cause instanceof ImportError
            ? cause.message
            : cause instanceof Error
              ? cause.message
              : '导入失败',
        )
      } finally {
        setImporting(false)
      }
    },
    [games, refresh],
  )

  const resetQuery = useCallback(() => setQuery({ text: '', category: null }), [])

  /**
   * 清空全部存档。
   *
   * 二次确认是这里唯一不能省的东西：存档只存在这台设备上，删掉就真的没有了
   * —— 没有云端、没有回收站。所以按钮先变成一句「确认清空 N 份」，再说一次
   * 「没有云端备份」，而不是点一下就动手。
   */
  const clearSaves = useCallback(async () => {
    setClearing(true)
    try {
      const removed = await saveService.clearAll()
      setSaveCount(0)
      setClearArmed(false)
      setDataNote(removed > 0 ? `已清空 ${removed} 份存档` : '本来就没有存档')
    } catch (cause) {
      setDataNote(cause instanceof Error ? `清空失败：${cause.message}` : '清空失败')
    } finally {
      setClearing(false)
    }
  }, [])

  return (
    <main className="library">
      <header className="library__head">
        <div className="library__brand">
          <h1 className="library__title">JAVA时光</h1>
          <p className="library__sub">Java 小游戏 · 点开即玩</p>
        </div>
        <label className={`library__import${importing ? ' library__import--busy' : ''}`}>
          {importing ? '导入中…' : '导入游戏'}
          <input
            ref={fileInput}
            type="file"
            accept=".jar,.jad,.zip,.data,application/java-archive"
            disabled={importing}
            onChange={handleImport}
          />
        </label>
      </header>

      <div className="library__search">
        <input
          type="search"
          className="library__search-input"
          placeholder="搜索游戏名、说明或作者"
          value={query.text}
          onChange={(event) => setQuery((current) => ({ ...current, text: event.target.value }))}
          aria-label="搜索游戏"
        />
        {query.text ? (
          <button
            type="button"
            className="library__search-clear"
            onClick={() => setQuery((current) => ({ ...current, text: '' }))}
            aria-label="清空搜索"
          >
            ×
          </button>
        ) : null}
      </div>

      {/* 分类做成横向滚动的一行：11 个分类在手机上换行会占掉半屏。 */}
      <nav className="library__chips" aria-label="分类">
        <CategoryChip
          label={`${ALL_LABEL} ${games.length}`}
          active={query.category === null}
          onClick={() => setQuery((current) => ({ ...current, category: null }))}
        />
        {CATEGORIES.map((category) => (
          <CategoryChip
            key={category.id}
            label={`${category.name} ${countByCategory(games, category.id)}`}
            active={query.category === category.id}
            onClick={() => setQuery((current) => ({ ...current, category: category.id }))}
          />
        ))}
        {importedCount > 0 ? (
          <CategoryChip
            label={`我导入的 ${importedCount}`}
            active={query.category === IMPORTED_CATEGORY}
            onClick={() => setQuery((current) => ({ ...current, category: IMPORTED_CATEGORY }))}
          />
        ) : null}
      </nav>

      {note ? (
        <p className="library__note" role="status">
          {note}
        </p>
      ) : null}
      {storageError ? (
        <p className="library__note library__note--warn" role="alert">
          本地库读不了（{storageError}）。内置游戏不受影响，但导入的游戏这次存不下。
        </p>
      ) : null}

      {/* 最近玩过只在「没在搜索、也没选分类」时出现：正在找某款游戏时，
          这条横条只是挡路。 */}
      {recent.length > 0 && query.category === null && query.text === '' ? (
        <section className="library__recent" aria-label="最近玩过">
          <h2 className="library__section-title">最近玩过</h2>
          <div className="library__recent-row">
            {recent.map((game) => (
              <a key={game.id} className="mini-card" href={playHash(game.id)}>
                <span className="mini-card__screen">
                  <Cover game={game} />
                </span>
                <span className="mini-card__title">{game.title}</span>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      <section className="library__grid-wrap" aria-label="游戏">
        {visible.length === 0 ? (
          <div className="library__empty">
            <p>没有符合条件的游戏</p>
            <button type="button" className="library__empty-action" onClick={resetQuery}>
              清空筛选
            </button>
          </div>
        ) : (
          <div className="library__grid">
            {visible.map((game) => (
              <a key={game.id} className="game-card" href={playHash(game.id)}>
                <span className="game-card__screen">
                  <Cover game={game} />
                  {game.source === 'imported' ? (
                    <span className="game-card__tag">已导入</span>
                  ) : null}
                </span>
                <span className="game-card__title">{game.title}</span>
                <span className="game-card__sub">{game.subtitle || game.author}</span>
              </a>
            ))}
          </div>
        )}
      </section>

      {/*
        本机数据。
        存档只在这台设备上，而「配额不足」的提示条告诉用户「清理一些浏览器
        存储」—— 那个动作原先并不存在，等于把问题推回给用户。这块面板就是它。
        清理只碰存档，不碰导入的游戏：那是两件事，混在一个按钮里会让人为了
        腾空间顺手删掉游戏。
      */}
      <section className="library__data" aria-label="本机数据">
        <h2 className="library__section-title">本机数据</h2>
        <p className="library__data-line">
          导入的游戏 {importedCount} 款 · 存档{' '}
          {saveCount === null ? '读不到' : `${saveCount} 份`}
        </p>
        <p className="library__data-hint">
          存档只存在这台设备的浏览器里，换设备或清理浏览数据就没有了。要带走，在游戏里用「存档 →
          导出」。
        </p>

        {dataNote ? (
          <p className="library__data-note" role="status">
            {dataNote}
          </p>
        ) : null}

        {saveCount !== null && saveCount > 0 ? (
          clearArmed ? (
            <div className="library__data-confirm" role="alertdialog" aria-label="确认清空存档">
              <p className="library__data-warn">
                清空后无法恢复：这是这份进度唯一的一份，没有云端备份。
              </p>
              <div className="library__data-actions">
                <button
                  type="button"
                  className="library__data-btn"
                  onClick={() => setClearArmed(false)}
                  disabled={clearing}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="library__data-btn library__data-btn--danger"
                  onClick={clearSaves}
                  disabled={clearing}
                >
                  {clearing ? '清空中…' : `确认清空 ${saveCount} 份`}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="library__data-btn"
              onClick={() => setClearArmed(true)}
            >
              清空全部存档
            </button>
          )
        ) : null}
      </section>

      <footer className="library__foot">
        <p>
          内置 {BUILTIN_GAMES.length} 款 · 内核 GPL-2.0 · 自有部分 GPL-2.0-or-later ·{' '}
          <a className="library__foot-link" href={ABOUT_HASH}>
            关于与许可
          </a>
        </p>
      </footer>
    </main>
  )
}

function CategoryChip(props: {
  readonly label: string
  readonly active: boolean
  readonly onClick: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)

  /*
   * 选中的 chip 要自动滚进视野。
   *
   * 「我导入的」排在最右，导入后自动切过去 —— 如果不滚，用户看到的是
   * 一行没变化的分类按钮和一张孤零零的卡片，完全不知道现在筛到了哪个分类。
   * `block: 'nearest'` 是为了只滚横条、不带着整页上下跳。
   */
  useEffect(() => {
    if (!props.active) return
    ref.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [props.active])

  return (
    <button
      ref={ref}
      type="button"
      className={`chip${props.active ? ' chip--active' : ''}`}
      aria-pressed={props.active}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  )
}

/**
 * 封面。
 *
 * 内置游戏有随包截图；导入的游戏没有，用一个带首字的色块顶上 —— 比空白框
 * 好认，也比现造一张假截图诚实。`onError` 兜住「截图缺失」：清单里有、文件
 * 被删掉时不该出现一个破图标。
 */
function Cover({ game }: { readonly game: GameEntry }) {
  const [failed, setFailed] = useState(false)
  if (game.source === 'imported' || failed) {
    return (
      <span className="cover cover--placeholder" aria-hidden="true">
        {game.title.slice(0, 1)}
      </span>
    )
  }
  return (
    <img
      className="cover"
      src={shotPath(game.id)}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}
