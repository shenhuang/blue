# 深海回响 (Deep Echo)

一款潜水题材的文字冒险 Roguelike。
从港口出发，下潜未知海域，在体力、氧气、理智、氮气的拉扯中追逐宝藏。
越深越不可知 —— 若能活着回来。

## 当前状态

当前实装状态的唯一权威是 [`docs/STATUS.md`](docs/STATUS.md) §1（活数字以 `npm run handoff` 为准）——本档不再手抄实装清单。

## 设计文档

- [`docs/spec/深海回响_SPEC.md`](docs/spec/深海回响_SPEC.md) — 主设计文档
- [`docs/spec/深海回响_战斗系统_SPEC.md`](docs/spec/深海回响_战斗系统_SPEC.md) — 战斗系统专题
- [`docs/spec/深海回响_上浮系统_SPEC.md`](docs/spec/深海回响_上浮系统_SPEC.md) — 上浮单按钮（结果=f(氧/氮/深/被追)·删假选择）
- [`docs/STATUS.md`](docs/STATUS.md) — **当前实装状态**

## 技术栈

Vite + React + TypeScript。JSON 配表。静态站点输出，可部署 GitHub Pages。

## 本地开发

```bash
npm install
npm run dev        # 启 Vite dev server (默认 http://localhost:5173)
npm run typecheck  # tsc --noEmit
npm run build      # 生产构建
```

## 验证

```bash
npm run regress    # 全绿门：typecheck + 全部 playthrough + 数据/边界校验门 + 生产构建
```

`node scripts/regress.mjs --list` 列全部检查；迭代用 `--only <子串>` 跑子集。每次改完代码/数据跑一遍。

## 目录结构

```
src/
├── types/     TypeScript 类型（state/events/enemies/items/npcs/dive/combat）
├── engine/    纯函数游戏逻辑（state/events/dialog/zones/mapgen/dive/ascent/combat/death）
├── ui/        React 组件（每个 GamePhase 一个视图）
├── data/      JSON 配表（events/、enemies/、items/npcs/zones/upgrades/actions）
└── App.tsx    顶层 phase 路由
```

## 路线图

当前状态与待办见 [`docs/STATUS.md`](docs/STATUS.md)；完整进度史见 [`docs/archive/CHANGELOG.md`](docs/archive/CHANGELOG.md)。

## License

未定。
