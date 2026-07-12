// 敌人词条（affix）系统试点（2026-07-12）——
// 元数据单一源：src/data/affixes.json（id / 中文名 / 颜色，喂 CombatView 彩色 tag + 未来图鉴）。
// 效果单一源：本文件（数值常量·占位 defer-number-tuning）+ engine/combat.ts 的 5 处接线点
// （berserk 二次攻击 / nimble 经 resolveDodge / hardshell 防御力乘数 / regen 回合开头回血 / venom 命中挂毒）。
//
// 未来「夺取敌人词条」（steal-on-kill）与状态/装备来源的闪避不在本次范围——但 resolveDodge（见 combat.ts）
// 已按「取 defenderAffixes 数组、可扩状态/装备分支」的形状预留，本次只接词条分支。

import affixesData from '@/data/affixes.json';

export interface AffixMeta {
  id: string;
  name: string;
  color: string;
}

/**
 * 词条 id 联合类型。单一真相仍是 affixes.json——这里手写字面量联合只为调用点的编译期收窄
 * （hasAffix(x, 'nimble') 之类的字面量能拿到自动补全 + typo 检查）。新增词条务必三处同步：
 * ① affixes.json 加条目 ② 这里加进联合 + HANDLED_AFFIX_IDS ③ combat.ts 接效果分支——
 * 少了②会被下面的 load-time 断言当场炸出来（少了③不会，那是效果层的事，靠 code review 守）。
 */
export type AffixId = 'berserk' | 'nimble' | 'hardshell' | 'regen' | 'venom';

const HANDLED_AFFIX_IDS: readonly AffixId[] = ['berserk', 'nimble', 'hardshell', 'regen', 'venom'];

export const AFFIX_META: Record<string, AffixMeta> = {};
for (const a of affixesData as AffixMeta[]) {
  AFFIX_META[a.id] = a;
}

/** 全部已注册词条 id（顺序＝affixes.json 文件顺序）。 */
export const AFFIX_IDS: string[] = (affixesData as AffixMeta[]).map((a) => a.id);

// load-time 断言：affixes.json 里每个 id 都必须是本文件实际接了效果的 5 个之一——
// 防止数据侧手滑加了新词条条目、代码侧却没人接效果分支（typo / 遗漏在加载时就炸，而不是静默无效）。
const unhandledAffixIds = AFFIX_IDS.filter((id) => !HANDLED_AFFIX_IDS.includes(id as AffixId));
if (unhandledAffixIds.length > 0) {
  throw new Error(
    `[engine/affixes.ts] affixes.json 声明了未接效果分支的词条 id：${unhandledAffixIds.join(', ')}——` +
      `要么在本文件 HANDLED_AFFIX_IDS/AffixId 补上并在 combat.ts 接效果，要么改回已知 id。`,
  );
}

export function getAffixMeta(id: string): AffixMeta | undefined {
  return AFFIX_META[id];
}

export function hasAffix(affixes: string[] | undefined, id: string): boolean {
  return !!affixes && affixes.includes(id);
}

/**
 * 随机抽词条（`EnemyDef.randomAffixes` 消费·敌人词条系统试点单词条随机化修正·2026-07-12）：
 * 从 `pool`（缺省 = 全部已注册词条 id·AFFIX_IDS）里不放回抽 `count` 个不重复 id（shuffle-and-take）。
 * `count` 会被夹进 `[0, effectivePool.length]`——防调用方传越界数字炸出空数组之外的诡异行为。
 * 用 `Math.random`（战斗层既有 RNG 约定·测试 harness 全局 monkeypatch 它来定 seed，别在这里另起 RNG）。
 * 未来「按 tier 提高 count」（tier 越高随机词条越多）直接调这个函数、把 count 换成派生值即可——占位。
 */
export function rollAffixes(pool: string[] | undefined, count: number): string[] {
  const effectivePool = pool ?? AFFIX_IDS;
  const n = Math.max(0, Math.min(count, effectivePool.length));
  if (n === 0) return [];
  // Fisher-Yates 洗牌后取前 n 个——不放回抽样的标准写法，只消耗 (pool.length - 1) 次 Math.random（够用·非热路径）。
  const shuffled = [...effectivePool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

// ── 效果常量（全部占位·defer-number-tuning：数值留到作者最后一次性统一调）──

/** 狂暴（berserk）：每回合额外攻击次数（→ 总共 1 + 本值 = 2 次/回合）。 */
export const BERSERK_EXTRA_ATTACKS = 1; // 占位·defer-number-tuning

/** 灵巧（nimble）：闪避概率——命中该判定则这一击伤害归零（resolveDodge 消费）。 */
export const NIMBLE_DODGE_CHANCE = 0.5; // 占位·defer-number-tuning

/** 硬壳（hardshell）：防御力乘数（applyAttack 算 effectiveDefense 时乘）。 */
export const HARDSHELL_DEFENSE_MULT = 1.2; // 占位·defer-number-tuning

/** 自愈（regen）：己方回合开始按最大 HP 的这个比例回血（封顶 def.hp）。 */
export const REGEN_HP_FRACTION = 0.1; // 占位·defer-number-tuning

/** 剧毒（venom）：命中玩家时额外挂的中毒状态（纯堆叠·战斗状态系统 SPEC §2.2，不去重不刷新）。 */
export const VENOM_STATUS = { kind: 'poisoned' as const, turns: 3, dmgPerTurn: 2 }; // 占位·defer-number-tuning

/**
 * 闪避判定单点（敌人词条系统试点·2026-07-12·仿 combat.ts::resolveDamage「任何单位攻击任何单位都过这个」·
 * 从 combat.ts 外移进这里·守 file-budget·2026-07-12 #298）：
 * 命中 → 这一击伤害归零、且不施加 applyStatusOnHit（调用方负责短路，见 combat.ts::applyAttack）。
 * **对称设计**：只吃一份 `defenderAffixes: string[] | undefined`，不区分"玩家防御"还是"敌人防御"——
 * 玩家↔敌↔敌任何一方当防御方都能调用同一份逻辑（同 resolveDamage 的对称约定）。
 * 当前只接了词条分支（nimble）；未来状态来源（如"警觉"状态）与装备来源（如某件防具）的闪避
 * 可在下面按「状态 → 词条 → 装备」的顺序 OR 短路挂进来——只要命中一个来源就算闪避，不必全查。
 * RNG：直接 `Math.random() < NIMBLE_DODGE_CHANCE`（等价于战斗层既有 `rollChance(NIMBLE_DODGE_CHANCE)`——
 * chance<1 时 rollChance 内部就是同一句 `Math.random() < chance`，逐字节不变）；不从这里反向 import
 * combat.ts 的 rollChance，affixes.ts 保持叶子模块、不参与 combat ↔ combat-* 的互相 import 环。
 */
export function resolveDodge(defenderAffixes: string[] | undefined): boolean {
  // —— 状态来源（未来）：如某 StatusKind 提供闪避加成，判定挂在这里 ——
  // —— 词条来源（本次接线）——
  if (hasAffix(defenderAffixes, 'nimble')) return Math.random() < NIMBLE_DODGE_CHANCE;
  // —— 装备来源（未来）：如某件防具/改装提供闪避，判定挂在这里 ——
  return false;
}
