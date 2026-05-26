# 深海回响 · 当前实装状态

> 截至 2026-05-26 第一个开发 session 收尾时的项目状态。
> 给"未来的自己"和"下一个接手 session 的 Claude"看。

---

## 1. 一句话状态

完整 meta-loop 跑通：**港口对话 → 教学线性下潜 → 节点图随机下潜 → 事件 → 战斗 → 上浮 → 减压 → 死亡 → 葬礼 → 尸体回收 → 衰减**。
TypeScript 类型干净，4 个端到端 playthrough 脚本全部通过。

---

## 2. 技术栈与运行

```bash
cd ~/Desktop/Blue
npm install
npm run dev        # 启 Vite dev server
npm run typecheck  # tsc --noEmit
npm run build      # 生产构建到 dist/
```

四个 playthrough 验证脚本（用 tsx 直接调引擎）：

```bash
npx tsx scripts/playthrough.ts          # 教学关 + 随机图 + 上浮（潜行路径）
npx tsx scripts/playthrough-combat.ts   # 教学关 + 战斗路径
npx tsx scripts/playthrough-corpse.ts   # 死亡 + 回港 + 尸体回收
npx tsx scripts/playthrough-decay.ts    # 衰减阈值 + 升级保鲜 + 海流冲走
node scripts/verify-tutorial.mjs        # 数据图引用完整性（纯 JS）
```

每次改完代码或数据建议跑一遍这五个脚本。

---

## 3. 已实装的系统

### 状态机（GamePhase）

```
port → dive → combat → dive → ascent → resolution → port
                ↑                ↓
              corpse           funeral → port  ← 死亡分支
```

| Phase | 子状态 | 文件 |
|---|---|---|
| port | NPC 对话 + 海域选择 | `PortView.tsx` |
| dive.event | 事件选项页 | `EventView.tsx` |
| dive.nodeSelect | 节点图选择 2–3 路 | `NodeSelectView.tsx` |
| dive.rest | 休息节点 / 上浮口 | `RestView.tsx` |
| dive.corpse | 尸体回收 | `CorpseView.tsx` |
| combat | 战斗 | `CombatView.tsx` |
| ascent | 三种上浮模式 | `AscentView.tsx` |
| resolution | 上岸结算 | `ResolutionView.tsx` |
| funeral | 死亡结算 | `CorpseView.tsx :: FuneralView` |
| gameOver | 真正的 catastrophic 结局（目前没路径走到这） | `ResolutionView.tsx` |

### 引擎模块（`src/engine/`）

- `state.ts` — GameState 构造 + 不可变操作 + inventory 工具
- `events.ts` — 事件解析、Outcome 应用、`performCheck` 概率检定、`tickTurns` 标准回合结算
- `dialog.ts` — NPC 对话树执行
- `zones.ts` — Zone 注册 + 事件池抽取（按 depth/tag/sanity/flag 过滤）
- `mapgen.ts` — 节点图生成 + corpse pass
- `dive.ts` — startDive / enterNodeSelection / moveToNode / restAtNode
- `ascent.ts` — 上浮方案 + 减压病 I/II/III/IV 型判定
- `combat.ts` — 战斗状态机、行动消费、敌人 AI、姿态、撤退逻辑
- `death.ts` — executeDeath / DeathRecord 生成 / ageAndDecayDeaths / findRecoverableCorpse / recoverFromCorpse / 衰减阈值

### 数据（`src/data/`）

- `items.json` — 13 件物品，全部标注 `decay` 档位
- `actions.json` — 8 个战斗行动
- `npcs.json` — Aldo + 3 节点对话树（教学前/教学后分支）
- `enemies/reef_shark.json` — 暗礁鲨（HP 32 / armor 0 / 主动撤退）+ 教学战斗 encounter
- `events/tutorial.json` — 6 个教学事件
- `events/reef.json` — 8 个浅海/中海事件（reef / wreck / cave）
- `zones.json` — 东礁（教学线性）+ 旧灯塔礁（随机图）
- `upgrades.json` — 船坞 / 气瓶库 / **打捞行会**（3 级，含保鲜系数）

### 关键数值（占位平衡，未细调）

- 起始：体力 100、氧气 60 回合、理智 100、氮气 0
- 检定公式：`successRate = clamp(0.5 + (stat - dc) × 0.015, 5%, 95%)`
- 减压：氮气 < 40 安全 / < 60 一停 / < 80 二停 / ≥ 80 三停
- 战斗中氮气累积 × 1.5（per spec，未实装）；理智衰减 × 1.2（per spec，未实装）
- 节点过渡 turn 数：`1 + Math.floor(depthDelta / 5)`
- 衰减阈值（diveAge）：organic 2 / consumable 5 / material 12 / durable 25 / eternal ∞
- 升级保鲜加成：lv1 +2 / lv2 +5 / lv3 +10
- 海流冲走：6% per item per run（lv3 免疫）

---

## 4. 本次 session 的关键设计决策

| 决策 | 取值 |
|---|---|
| 地图结构 | 随机节点 + 深度推进 |
| 时间粒度 | 回合制，事件可加额外消耗 |
| 死亡模型 | 硬核 Roguelike + 尸体回收 + 建设值永久积累 |
| 恐惧节奏 | 理智值驱动 + 深度加速衰减 |
| 上浮 | 随时可上浮 + 应急上浮必得严重减压病 |
| 装备 | 5 固定槽位 + 装备 + 词缀（MVP 仅等级）|
| 港口升级 | 多分支升级树（船坞 / 气瓶库 / 打捞行会 / 教堂） |
| 战斗经济 | 双资源直读（体力 + 氧气回合） |
| 位置维度 | 无（武器性格代替） |
| 多敌 | 1–4 个，独立 aggro / 姿态 / AI |
| 伤害类型 | 双轨（物理 + 理智），克苏鲁敌人未实装 |
| 重生叙事 | **D 设定**：早期表现为不同潜水员；中期开始故障；终局揭示一直是同一人 |
| 教学关名 | 「初次潜水」（不是「资格潜水」） |

---

## 5. 还没接的功能（推荐处理顺序）

### 高优先级（meta-loop 最后一公里）

- [ ] **港口升级 UI** —— 数据全在 `upgrades.json`，需要 PortView 加面板。玩家能赚建设值但花不出去。
- [ ] **教学结尾日志的港口触发** —— 玩家拿了 `item.captain_log` 回港，应自动触发 `tutorial.ending_log` 那段 cutscene。
- [ ] **战利品变卖（goldDelta）** —— 回港后 Mira 收购材料，目前 `computeLootValue` 是占位 0。

### 中优先级（味道）

- [ ] **D-reveal 文本故障化** —— FuneralView 按 `profile.deaths.length` 阈值改变 diverName 渲染：1–4 正常，5–9 笔误，10+ 故障文字，触发 lore 后变"你"。
- [ ] **更多敌人 + 理智伤害实装** —— `EnemyAttack.sanityDamage` 已支持，但没敌人配置。给中海层加 1–2 个 uncanny 敌人。
- [ ] **打捞行会 Lv.1 的 corpse hint UI 显示** —— `hasCorpseHint` 字段已经透传到 NodeChoice，但目前默认就显示。Lv.1 才该显示。
- [ ] **打捞行会 Lv.2 的出海前选目标** —— 港口面板加选择 UI，把选定 DeathRecord 强制塞进 mapgen。

### 低优先级（扩展）

- [ ] **尸体衰减时的 UI 提示** —— 玩家回港时如果有尸体衰减/被冲走，给个 toast 提示，制造紧迫感。
- [ ] **亡者之径事件** —— 同 zone ≥ 5 具尸体时强制生成 `cave.choir` 节点。
- [ ] **失能（Incapacitated）状态** —— 体力 0 不直接死，给"最后挣扎"窗口。
- [ ] **战斗中氮气 ×1.5 / 理智 ×1.2** —— per 战斗 SPEC §10，未实装。
- [ ] **背包负重影响上浮速度** —— per 主 SPEC §8.2，未实装。

---

## 6. 已知的 quirk 和注意事项

1. **沙箱权限**：在 Linux 沙箱里跑 `npm run build` 第二次会失败（删不掉旧 dist/），跑 `npm run dev` 同样问题（删不掉 .vite 缓存）。**用户本地 Mac 没问题**。
2. **第二次 build 前需要清缓存**：`rm -rf node_modules/.vite dist`。
3. **`performCheck` 用概率窗口模型**，不是 D&D 风格的 d20+bonus。事件 JSON 里的 `dc` 直接是 stat 比较值，不是 D&D dc。
4. **mapgen 的 event 概率是 80%**（从 70% 调上来过一次），rest 10%，ascent_point 10%。
5. **教学暗礁鲨调过两次**：原 50HP/6-10dmg 太硬，现 32HP/4-7dmg + 主动撤退（territorial 类敌人 HP ≤ 30% 时 50% 撤退）。
6. **diveAge 在两个地方递增**：`executeDeath`（给旧死者）+ `executeAscent`（每次成功上浮也老化海底）。不要再加第三处，否则双计数。
7. **NPC 对话的 startDive effect** 现在通过 `startDive(state, zoneId)` 拉起，会自动决定线性还是随机图。

---

## 7. 仓库结构

```
Blue/
├── docs/
│   ├── 深海回响_SPEC.md              主设计文档
│   ├── 深海回响_战斗系统_SPEC.md     战斗系统专题
│   ├── 深海回响_教学关剧本.md        第一次下潜剧本
│   ├── STATUS.md                     ← 本文件
│   └── legacy/                        早期草案
├── src/
│   ├── App.tsx, main.tsx, styles.css
│   ├── types/    (state/events/enemies/items/npcs/dive/combat/index)
│   ├── engine/   (state/events/dialog/zones/mapgen/dive/ascent/combat/death)
│   ├── ui/       (PortView/EventView/NodeSelectView/RestView/CombatView/AscentView/CorpseView/ResolutionView/StatusBar)
│   └── data/     (items/actions/npcs/zones/upgrades + events/ + enemies/)
├── scripts/
│   ├── verify-tutorial.mjs           数据图引用完整性
│   ├── playthrough.ts                教学+随机图+上浮
│   ├── playthrough-combat.ts         战斗
│   ├── playthrough-corpse.ts         死亡+回收
│   └── playthrough-decay.ts          衰减+海流
├── package.json, tsconfig.json, vite.config.ts, index.html, README.md
```

---

## 8. 下次接手时的快速 onboarding

1. 读 `docs/深海回响_SPEC.md` 主 SPEC（前 6 节即可对齐世界观和核心循环）
2. 读 `docs/深海回响_战斗系统_SPEC.md` §2–§7（战斗基本机制）
3. 读本文件第 3、5、6 节
4. 跑 `npx tsx scripts/playthrough.ts` 看一次完整 trace，几秒搞定
5. `npm run dev` 在自己机器上点一遍 UI

然后就能开始接「港口升级 UI」或者其他你想做的。
