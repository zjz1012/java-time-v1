/**
 * 极简类型安全事件总线。
 *
 * 设计意图：运行时会向外发出状态、帧、错误、退出四类事件，
 * 消费者必须拿到强类型载荷。不引入第三方 event emitter，
 * 避免为一个 40 行的需求增加一个无版本锁定的依赖。
 */
export class TypedEmitter<Events extends Record<string, unknown>> {
  readonly #listeners = new Map<keyof Events, Set<(payload: never) => void>>()

  /**
   * 订阅事件，返回取消订阅函数。
   * 取消函数是幂等的 —— 重复调用不会报错，也不会影响其他订阅者。
   */
  on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): () => void {
    let bucket = this.#listeners.get(event)
    if (!bucket) {
      bucket = new Set()
      this.#listeners.set(event, bucket)
    }
    const entry = listener as (payload: never) => void
    bucket.add(entry)
    return () => {
      this.#listeners.get(event)?.delete(entry)
    }
  }

  /**
   * 广播事件。单个订阅者抛错不会中断其余订阅者 ——
   * UI 崩溃不应该让运行时状态机停在半途。
   */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const bucket = this.#listeners.get(event)
    if (!bucket) return
    for (const listener of [...bucket]) {
      try {
        ;(listener as (value: Events[K]) => void)(payload)
      } catch (cause) {
        console.error(`[events] listener for "${String(event)}" threw`, cause)
      }
    }
  }

  /** 清空全部订阅，用于 dispose。 */
  clear(): void {
    this.#listeners.clear()
  }
}
