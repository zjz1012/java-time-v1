/**
 * 构建期注入的常量。
 *
 * 值由 `vite.config.ts` 的 `define` 从正本读出（package.json 的 version、
 * scripts/fetch-upstream.sh 里钉定的内核 commit），不手抄 —— 关于页显示的
 * 版本与分发内容对不上，比不显示更糟。
 *
 * 声明放在这里而不是散在用的地方：`tsc --noEmit` 走同一份声明，写错名字
 * （`__KERNEL_PIN__`）会直接编译失败，而不是在运行页上渲染成 undefined。
 */
declare const __APP_VERSION__: string
declare const __KERNEL_COMMIT__: string
/** 随包游戏的款数（`total`）与其中自研的款数（`self`），其余按 MIT 授权计入。 */
declare const __PACK_GAMES__: { readonly total: number; readonly self: number }
