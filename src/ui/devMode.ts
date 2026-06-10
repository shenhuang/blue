// Dev 工具门控的单一来源（#109 从 App.tsx 迁出·语义零变化——多处 UI 要读它：App 面板 + Mira 测试货架）。
//
// 作者 2026-06-06 拍板（quirk #97）：本地 dev server 恒开；**发布版也带 dev**，但默认隐藏——
// 仅当 URL 带 ?dev（如 https://shenhuang.github.io/blue/?dev）才启用，藏在 Shift+D/C/M 快捷键 /
// dev 专属 UI 后，普通访客看不到。**运行时**值（prod 里不是编译期 false）→ Rollup 不 dead-code
// 消除引用它的三元，dev 面板仍按 lazy chunk 进 bundle、仅 ?dev 打开时下载（普通访客零额外负载）。
// 别改回 `import.meta.env.DEV`（会去掉线上 dev·作者就没法在线上测）——见 QUIRKS #97。
// `env?.` 可选链：node/tsx（playthrough/smoke 脚本 import UI 模块）没有 Vite 的 import.meta.env——
// 缺省成 false（脚本里无 window 也无 ?dev＝恒 false·与 App.tsx 时代行为一致，当时脚本不 import 它）。
export const DEV_TOOLS =
  (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true ||
  (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('dev'));
