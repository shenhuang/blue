# 武器系统实现交接 Prompt

## 起手

```bash
npm run handoff
```

确认基线绿（昨晚 nightly 已跑）。快速体检用 `npm run regress:quick`。

---

## 任务概述

为 Blue 实现一套完整武器系统，包含：新武器、盾牌、负重档位、弹药消耗品、武器改装槽。

---

## 现有基础（不要重造）

- `src/engine/equipment.ts` — 装备核心：`getEquipmentStats`, `weaponDamageForSlot`, `equipItem`, `craftEquipment`, `upgradeEquipment`
- `src/types/items.ts` — `EquipmentSlot`（含 `tool` / `ranged`）、`EquipmentEffect`、`UpgradeStep`
- `src/data/items.json` — 物品注册表
- `src/engine/combat.ts` — `actionCosts`, `weaponDamageForSlot`, `injuryOnHit`
- 现有武器：`item.dive_knife.standard`（`tool` 槽，有 upgradeSteps）

---

## 新增内容

### 1. 新武器 / 盾牌（加进 items.json）

| id | 名称 | slot | 特性 |
|----|------|------|------|
| `item.weapon.rescue_axe` | HD-3 救援斧 | tool | 高伤高重，解锁事件行为 |
| `item.weapon.pneumatic_pistol` | AP-12 气动短枪 | ranged | 中伤，独立弹药，有 signature 小幅上升 |
| `item.weapon.harpoon_rifle` | PR-40 鱼叉步枪 | ranged | 高伤，独立弹药，signature 大幅上升 |
| `item.shield.basic` | 防护盾 | ranged | 零伤，被动减伤，不解锁攻击 action |

### 2. 弹药（consumable，占背包位）

| id | 对应武器 | 购买来源 |
|----|---------|---------|
| `item.ammo.pneumatic` | AP-12 | 港口购买 |
| `item.ammo.harpoon` | PR-40 | 港口购买 |

- `category: "consumable"`, `usableIn: ["combat"]`
- 开枪动作在 `requiresAmmo` 字段注明弹药 id；开枪前检查库存，无弹药则 action 不可用
- 每次射击消耗 1 发

### 3. 负重系统

#### 数据层
- `src/types/items.ts` 的 `EquipmentMeta` 加 `weight: number` 字段（已有，确认接入）
- 每件装备设计数值参考（可调）：

| 装备 | weight |
|------|--------|
| 潜水刀 | 1 |
| HD-3 救援斧 | 5 |
| AP-12 气动短枪 | 3 |
| PR-40 鱼叉步枪 | 6 |
| 防护盾 | 4 |
| 普通防寒服 | 2 |
| 加固潜水服 | 4 |
| 蓝鳍 Mk.I 气瓶 | 3 |
| 其余件 | 1–2 |

#### 派生（engine/equipment.ts 新增）

```ts
export type WeightTier = 'light' | 'medium' | 'heavy' | 'overloaded';

export function totalLoadoutWeight(loadout: EquipmentLoadout): number
export function weightTier(weight: number): WeightTier
// 阈值提案（可调）：0–8=light, 9–14=medium, 15–20=heavy, 21+=overloaded
```

#### 战斗接入（engine/combat.ts）

- `actionCosts` 读 `weightTier`：
  - light: stamina ×1.0
  - medium: stamina ×1.5
  - heavy: stamina ×2.0
  - overloaded: 所有行动返回 `available: false`（「负重过载，无法行动」）
- 敌方命中率修正（在伤害判定处）：
  - light: 命中率 −10%
  - medium: 无修正
  - heavy: 命中率 +10%
  - overloaded: 命中率 +15%

#### 出发门控

- `dive-start.ts` 或 port 出发逻辑：`weightTier === 'overloaded'` 时拦截，返回提示

#### UI（装备屏）

- 显示总负重数值 + 档位文字（轻装 / 中装 / 重装 / **过载**）
- 颜色：绿 / 黄 / 橙 / 红
- 过载时出发按钮禁用 + tooltip 说明

---

### 4. 武器改装槽

#### 数据层（types/items.ts）

```ts
// EquipmentMeta 加：
modSlot?: boolean;  // 该武器是否接受改装组件

// EquipmentInstance 加：
mod?: string;  // 当前装入的改装组件 itemId（可选）
```

#### 改装组件（items.json，category: "weaponMod"）

| id | 名称 | 效果描述 |
|----|------|---------|
| `item.mod.poison_sac` | 毒囊 | 命中时概率施加中毒伤势 |
| `item.mod.barb_kit` | 倒刺套件 | 命中时概率造成撕裂伤（更重的伤势） |
| `item.mod.silent_wrap` | 静音套 | 近战攻击不触发 signature 上升 |
| `item.mod.shock_core` | 放电芯 | 命中时消耗 power，附加额外伤害 |

近战武器（tool 槽）支持全部改装组件；ranged 槽和未来武器可能有专属组件，当前不设计。

#### 逻辑（equipment.ts）

```ts
export function installMod(state: GameState, slot: EquipmentSlot, modItemId: string): GameState
// 检查：武器有 modSlot=true，库存有该 mod 组件，slot 匹配 tool（当前限制）
// 操作：消耗组件，写 inst.mod = modItemId（旧 mod 不返还）
```

#### 战斗接入（combat.ts）

- 命中后读 `inst.mod`，按 id 分支应用效果：
  - `poison_sac` → 调用 injury 系统施加中毒
  - `barb_kit` → 施加撕裂伤
  - `silent_wrap` → 跳过 signature 上升逻辑
  - `shock_core` → 检查 `run.power > 0`，扣 power，伤害 +N

---

### 5. 潜水刀补改装槽

`item.dive_knife.standard` 的 equipment meta 加 `"modSlot": true`。

---

### 6. 消防斧事件解锁

`item.weapon.rescue_axe` 的 equipment effects 加：

```json
{ "kind": "unlocksAction", "actionId": "action.axe_chop" },
{ "kind": "unlocksAction", "actionId": "action.axe_pry" }
```

`action.axe_pry` 供事件系统用（`hasEquipment: { slot: 'tool', actionId: 'action.axe_pry' }`），让「撬开舱门」「破障」类事件选项在持斧时可用。实际事件文案本次不写，只把 action 注册好。

---

## 不做（本次范围外）

- 强化弹药（enhanced ammo）
- 双手武器（占两槽）
- 盾牌主动 block action
- ranged 武器改装组件
- 弹药升级/改装

---

## 完成标准

`npm run regress` 全绿（含 typecheck + check-boundaries + build）。

新加的 `EquipmentEffect` kind（如有）必须在 `equipment.ts::addEffects` switch 里覆盖，否则 typecheck 报漏。

`EquipmentSlot` 穷举断言已有（`_slotsExhaustive`），不加新槽不需要改。

---

## 数值均为提案，作者可直接在 items.json 里调
