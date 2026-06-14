// Dev 工具门控的单一来源（#109·多处 UI 读它：App 面板 / 解锁大区 / dev 按钮 / Mira 测试货架 / 教学门）。
//
// 作者 2026-06-14 改（原 quirk #97「本地 dev server 恒开」已撤）：**只认 URL ?dev**——`npm run dev`
// 默认也走真玩家流程、不再自动开 dev（治作者报「没加 ?dev 也能用 dev 全区域解锁」；npm-dev 恒开会让
// 真玩家流程没法在本地测）。要 dev 一律加 ?dev：本地 http://localhost:5173/?dev·线上
// https://shenhuang.github.io/blue/?dev。**运行时**值（window.location.search·非编译期）→ Rollup 不
// dead-code 消除·dev 面板仍按 lazy chunk 进 prod bundle、仅 ?dev 下载（普通访客零负载·线上 ?dev 仍可测）。
// 别改成 import.meta.env.DEV（编译期会被消除·线上就没 dev 了）。node/tsx 脚本无 window＝恒 false。
export const DEV_TOOLS =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('dev');
