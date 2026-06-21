// 尸衣者占据玩家尸体变体
// 纯函数层：tier 判定、占据概率、武器→攻击映射、动态 encounter 构建。
// 调用方：dive-move.ts case 'corpse':（唯一插入点）。
// 不改动：skinLoot 动物尸体行为、recoverFromCorpse、salvage_guild 逻辑。

import type { DeathRecord, EnemyAttack, CombatEncounterDef, EnemyPartyMemberDef } from '@/types';
import { getEnemyDef } from './combat';

// ——— Tier 判定 ———

/**
 * 节点深度 → 尸衣者占据档位（纯函数·无副作用）。
 *  0 (<30m)   ：不占据玩家尸体，直接进回收界面。
 *  1 (30–60m) ：占据，基础两攻击 + 潜水员版 introText。
 *  2 (60–90m) ：取 inventorySnapshot 第一件武器映射成额外攻击。
 *  3 (>90m)   ：取前两件武器，两个变体都加进攻击表。
 */
export function resolveCorpseWearerTier(depth: number): 0 | 1 | 2 | 3 {
  if (depth < 30) return 0;
  if (depth < 60) return 1;
  if (depth < 90) return 2;
  return 3;
}

/**
 * 档位 → 尸衣者占据概率（纯函数）。
 * 与现有 corpseChance=0.6（是否生成尸体节点）独立——先生成节点，再判断有没有被占。
 */
export function corpseWearerChance(tier: 0 | 1 | 2 | 3): number {
  switch (tier) {
    case 0: return 0;
    case 1: return 0.25;
    case 2: return 0.40;
    case 3: return 0.55;
  }
}

// ——— 武器 → 攻击变体 ———

/**
 * 物品 id → 尸衣者附加攻击变体（纯函数）。
 * 识别不了的 itemId 返回 null，跳过，不报错。
 * 叙事立场：尸衣者穿着你的装备、用你的东西来对付你。
 */
export function weaponToAttack(itemId: string): EnemyAttack | null {
  switch (itemId) {
    case 'item.dive_knife.standard':
      return {
        id: 'corpse_wearer.worn_knife',
        name: '熟悉的刀',
        damageType: 'physical',
        damage: [3, 6],
        description: '它从那具皮囊里抽出你的刀——刀柄上还是你握惯的那个角度——划过来。',
        weight: 2,
      };
    case 'item.weapon.rescue_axe':
      return {
        id: 'corpse_wearer.worn_axe',
        name: '劈落的斧',
        damageType: 'physical',
        damage: [5, 9],
        description: '你的救援斧高高抡起，落下来的弧线和你用它时一模一样。这不是巧合——它记住了你的动作。',
        weight: 2,
      };
    case 'item.weapon.pneumatic_pistol':
      return {
        id: 'corpse_wearer.worn_pistol',
        name: '气动点射',
        damageType: 'physical',
        damage: [4, 7],
        description: '枪口对准你。你知道里面还剩几发——你数过，装进去的时候你一发一发地数。',
        weight: 2,
      };
    case 'item.weapon.harpoon_rifle':
      return {
        id: 'corpse_wearer.worn_harpoon',
        name: '鱼叉',
        damageType: 'physical',
        damage: [7, 12],
        description: '鱼叉从皮囊手里射出来，直穿过水。那杆你扛过无数次的大家伙，现在对着你的方向。',
        weight: 2,
      };
    default:
      return null;
  }
}

// ——— 动态 Encounter 构建 ———

const INHABITED_INTRO_BY_TIER: Record<1 | 2 | 3, string> = {
  1: '你认出了那个潜水服。你找到了——然后它从里面撑开了，用一种你的身体不该有的姿势站了起来。',
  2: '潜水服还摆在原来的地方，但角度歪了，头低着。你还没靠近，它已经转过来对准了你——不是眼睛，是整个面向，在黑水里把你找到了。',
  3: '你的尸体坐在那里，等你。潜水服是满的——皮、配重、气瓶——里头撑起来的东西，把所有该垂下去的地方都撑得很合身。它抬起了你死前习惯戴的手套，朝你方向招了一下。',
};

/**
 * 根据 DeathRecord + tier 构建运行时 CombatEncounterDef（不注册进 COMBAT_ENCOUNTERS）。
 *  tier 1：基础两攻击（撑裂 + 戴着的脸） + 潜水员版 introText。
 *  tier 2：+ inventorySnapshot 第一件武器的攻击变体。
 *  tier 3：+ 前两件武器的变体。
 * wornSkin='player'：effectiveLoot 找不到此 key → 回落 def.loot（动物皮囊行为不变·不需要加 skinLoot['player']）。
 */
export function buildInhabitedCorpseEncounter(
  record: DeathRecord,
  tier: 1 | 2 | 3,
): CombatEncounterDef {
  const baseDef = getEnemyDef('enemy.corpse_wearer');
  const baseAttacks: EnemyAttack[] = baseDef?.attacks ?? [];

  // 从 inventorySnapshot 按顺序找武器攻击变体（最多取 tier-1 件）
  const maxWeapons = tier >= 3 ? 2 : tier >= 2 ? 1 : 0;
  const extraAttacks: EnemyAttack[] = [];
  for (const it of record.inventorySnapshot) {
    if (extraAttacks.length >= maxWeapons) break;
    const atk = weaponToAttack(it.itemId);
    if (atk) extraAttacks.push(atk);
  }

  // tier 1 用 def.attacks（不设 attacksOverride）；tier 2/3 合并攻击表
  const attacksOverride: EnemyAttack[] | undefined =
    extraAttacks.length > 0 ? [...baseAttacks, ...extraAttacks] : undefined;

  const member: EnemyPartyMemberDef = {
    defId: 'enemy.corpse_wearer',
    wornSkin: 'player',
    ...(attacksOverride ? { attacksOverride } : {}),
  };

  return {
    id: `combat.inhabited_corpse.${record.id}`,
    party: { members: [member] },
    introText: INHABITED_INTRO_BY_TIER[tier],
  };
}
