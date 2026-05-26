# 深海回响 (Deep Echo)

一款潜水题材的文字冒险 Roguelike。
从港口出发，下潜未知海域，在体力、氧气、理智、氮气的拉扯中追逐宝藏。
越深越不可知 —— 若能活着回来。

## 当前状态

**第一里程碑：完整 meta-loop 闭环。** 详见 [`docs/STATUS.md`](docs/STATUS.md)。

已实装：港口对话 / 教学线性下潜 / 节点图随机下潜 / 事件 / 战斗 / 上浮 / 减压病 / 死亡 / 葬礼 / 尸体回收 / 物品衰减 / 海流冲走。

## 设计文档

- [`docs/深海回响_SPEC.md`](docs/深海回响_SPEC.md) — 主设计文档
- [`docs/深海回响_战斗系统_SPEC.md`](docs/深海回响_战斗系统_SPEC.md) — 战斗系统专题
- [`docs/深海回响_教学关剧本.md`](docs/深海回响_教学关剧本.md) — 教学剧本
- [`docs/STATUS.md`](docs/STATUS.md) — **当前实装状态 + 下次接手指南**
- [`docs/legacy/`](docs/legacy/) — 早期草案

## 技术栈

Vite + React + TypeScript。JSON 配表。静态站点输出，可部署 GitHub Pages。

## 本地开发

```bash
npm install
npm run dev        # 启 Vite dev server (默认 http://localhost:5173)
npm run typecheck  # tsc --noEmit
npm run build      # 生产构建
```

## 验证脚本

四条端到端 playthrough，调用项目自身引擎模块，跑完整 timeline：

```bash
npx tsx scripts/playthrough.ts         # 教学 + 随机图 + 上浮
npx tsx scripts/playthrough-combat.ts  # 战斗路径
npx tsx scripts/playthrough-corpse.ts  # 死亡 + 尸体回收
npx tsx scripts/playthrough-decay.ts   # 物品衰减 + 升级保鲜
node scripts/verify-tutorial.mjs       # 数据图引用完整性
```

每次改完代码或数据建议跑一遍。

## 目录结构

```
src/
├── types/     TypeScript 类型（state/events/enemies/items/npcs/dive/combat）
├── engine/    纯函数游戏逻辑（state/events/dialog/zones/mapgen/dive/ascent/combat/death）
├── ui/        React 组件（每个 GamePhase 一个视图）
├── data/      JSON 配表（events/、enemies/、items/npcs/zones/upgrades/actions）
└── App.tsx    顶层 phase 路由
```

## 接下来要做的

按 `docs/STATUS.md` §5 顺序：

1. **港口升级 UI**（meta-loop 最后一公里）
2. **教学结尾日志在港口触发**
3. **战利品变卖**
4. **D-reveal 文本故障化**
5. **更多敌人 + 理智伤害实装**

## License

未定。
