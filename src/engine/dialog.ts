// 对话引擎 —— 港口 NPC 对话
// 数据按 NPC 拆分在 src/data/npcs/<npcId>.json，引擎只做"按 id 取节点"和"应用 effect"

import type { GameState, DialogNode, DialogChoice, DialogEffect, NpcDef, PlayerProfile } from '@/types';
import { NPC_FILES } from './npcRegistry';
import { createNewRun, acquireIntoProfile, removeFromInventory } from './state';
import { startDive } from './dive';
import { getRunBonuses } from './lighthouses';
import { gainTrust } from './trust';

const NPC_INDEX: Map<string, NpcDef> = new Map();
const DIALOG_INDEX: Map<string, DialogNode> = new Map();
for (const f of NPC_FILES) {
  NPC_INDEX.set(f.npc.id, f.npc);
  DIALOG_INDEX.set(f.npc.dialogRoot.id, f.npc.dialogRoot);
  if (f.dialogs) {
    for (const [id, node] of Object.entries(f.dialogs)) {
      DIALOG_INDEX.set(id, node);
    }
  }
}

export function getNpc(id: string): NpcDef | undefined {
  return NPC_INDEX.get(id);
}

export function listNpcs(): NpcDef[] {
  return [...NPC_INDEX.values()];
}

export function getDialogNode(id: string): DialogNode | undefined {
  return DIALOG_INDEX.get(id);
}

export function applyDialogEffects(
  state: GameState,
  effects: DialogEffect[] | undefined
): GameState {
  if (!effects) return state;
  let s = state;
  for (const e of effects) {
    switch (e.kind) {
      case 'setFlag': {
        const flags = new Set(s.profile.flags);
        flags.add(e.flag);
        s = { ...s, profile: { ...s.profile, flags } };
        break;
      }
      case 'removeFlag': {
        const flags = new Set(s.profile.flags);
        flags.delete(e.flag);
        s = { ...s, profile: { ...s.profile, flags } };
        break;
      }
      case 'giveGold':
        if (s.run) {
          s = { ...s, run: { ...s.run, gold: s.run.gold + e.amount } };
        } else {
          s = {
            ...s,
            profile: { ...s.profile, bankedGold: s.profile.bankedGold + e.amount },
          };
        }
        break;
      case 'takeGold':
        if (s.run) {
          s = { ...s, run: { ...s.run, gold: Math.max(0, s.run.gold - e.amount) } };
        } else {
          s = {
            ...s,
            profile: {
              ...s.profile,
              bankedGold: Math.max(0, s.profile.bankedGold - e.amount),
            },
          };
        }
        break;
      case 'startDive': {
        // 随身加成 = 全局升级 ＋ 家灯塔「船坞」设施（dockyard 迁灯塔后的桥，见 lighthouses.ts::getRunBonuses）
        // RunStartBonuses 字段全是 createNewRun bonuses 的超集，直接整个传（含深水区 Phase 0 升级轨，避免抄漏）。
        const bonuses = getRunBonuses(s.profile);
        const run = createNewRun({ zoneId: e.zoneId, bonuses, equipment: s.profile.equipment });
        s = { ...s, run };
        s = startDive(s, e.zoneId);
        break;
      }
      case 'openChart':
        // 切到顶层 chart phase；UI 层（App.tsx）挂 SeaChartView。
        s = { ...s, phase: { kind: 'chart' } };
        break;
      case 'openShop':
        // 切到顶层 shop phase；UI 层（App.tsx）负责挂对应面板。
        s = { ...s, phase: { kind: 'shop', shopId: e.shopId } };
        break;
      case 'giveItem': {
        // 直接发物进 profile（同购买 / 回港 loot / devGrantItem 作弊路径·acquireIntoProfile 单点：
        // 顺带兑现该物品的 story.setsFlag 里程碑·sticky 幂等·见 state.ts）。
        s = { ...s, profile: acquireIntoProfile(s.profile, [{ itemId: e.itemId, qty: e.qty }]) };
        break;
      }
      case 'takeItem': {
        // 消耗背包里的指定物（上交收藏品等·复用 state.ts::removeFromInventory 单点·同 port.ts 花币扣减）。
        s = {
          ...s,
          profile: { ...s.profile, inventory: removeFromInventory(s.profile.inventory, e.itemId, e.qty) },
        };
        break;
      }
      case 'gainTrust': {
        // 涨信任唯一写口＝engine/trust.ts::gainTrust（规则七·dialog.ts 不在该字段白名单·信任变更必须经此）。
        s = { ...s, profile: gainTrust(s.profile, e.npcId, e.amount).profile };
        break;
      }
      case 'openUpgradeTree':
        // TODO 实现：升级树面板（Mira 之外的店暂未实现）
        break;
    }
  }
  return s;
}

/** "已聊"追踪键：choice.id 只在所属节点内唯一，拼上 node.id 才全局唯一（见 PlayerProfile.seenChoices）。 */
function seenKey(nodeId: string, choiceId: string): string {
  return `${nodeId}::${choiceId}`;
}

/** 记录某选项已被选过——profile.seenChoices 唯一写口（幂等：已记录则原样返回，不白拷 Set）。 */
function markChoiceSeen(profile: PlayerProfile, nodeId: string, choiceId: string): PlayerProfile {
  const key = seenKey(nodeId, choiceId);
  const seen = profile.seenChoices ?? new Set<string>();
  if (seen.has(key)) return profile;
  return { ...profile, seenChoices: new Set(seen).add(key) };
}

export function selectChoice(
  state: GameState,
  current: DialogNode,
  choice: DialogChoice
): { state: GameState; next: DialogNode | null } {
  let s = state;
  s = { ...s, profile: markChoiceSeen(s.profile, current.id, choice.id) };
  s = applyDialogEffects(s, choice.effects);
  // 如果是 startDive 一类的转 phase effect，会返回 phase != port，则关闭对话
  if (s.phase.kind !== 'port') return { state: s, next: null };

  if (choice.next === 'end') {
    return { state: s, next: null };
  }
  const node = getDialogNode(choice.next);
  if (!node) {
    console.warn(`Dialog node not found: ${choice.next}`);
    return { state: s, next: null };
  }
  // 进入新节点时执行其 onEnter effects
  const s2 = applyDialogEffects(s, node.onEnter);
  return { state: s2, next: node };
}

/** 对话面板一次最多摊开显示的选项数；超过则挑 DIALOG_DISPLAY_CAP 条 + 外加"换个话题"按钮轮换。 */
export const DIALOG_DISPLAY_CAP = 3;

function shuffle<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 对话选项面板显示收窄（作者 2026-07-03 拍板）：候选（已过 visibleIf 门控）超过 DIALOG_DISPLAY_CAP 条时，
 * 只显示三档中挑出的 DIALOG_DISPLAY_CAP 条 + 外加"换个话题"按钮轮换，别一次性摊成长列表。
 *
 * 三档优先级（从高到低）：
 *  1. 新——非 filler 且没被选过（profile.seenChoices 无记录）。
 *  2. 已聊——非 filler 但选过（面板灰显，见 PortView.tsx）。
 *  3. 同功能——标了 filler:true 的选项（跟卡片/常驻按钮功能重复，比如"把材料摊在柜台上"）；只在
 *     「新+已聊」凑不满显示上限时才补位——凑满了就整档从候选池摘掉，不是排队等轮到。
 * 保底：非空档数 >1 时预留 1 个位置做轮换（否则最高档恰好=上限时"换话题"点了跟没点一样）。
 * randomize=false（刚进节点/推进新节点）取确定顺序；randomize=true（点了"换个话题"）才真随机重抽。
 */
export function selectDisplayChoices(
  profile: PlayerProfile,
  node: DialogNode,
  visibleChoices: DialogChoice[],
  randomize: boolean
): { shown: DialogChoice[]; needsRotate: boolean } {
  if (visibleChoices.length <= DIALOG_DISPLAY_CAP) {
    return { shown: visibleChoices, needsRotate: false };
  }
  const seen = profile.seenChoices ?? new Set<string>();
  const isSeen = (c: DialogChoice) => seen.has(seenKey(node.id, c.id));

  const fresh = visibleChoices.filter((c) => !c.filler && !isSeen(c));
  const seenNormal = visibleChoices.filter((c) => !c.filler && isSeen(c));
  const fillerAll = visibleChoices.filter((c) => c.filler);
  const nonFillerCount = fresh.length + seenNormal.length;
  const filler = nonFillerCount >= DIALOG_DISPLAY_CAP ? [] : fillerAll;

  // 同功能被整档挤出后，可能剩下的「新+已聊+补位同功能」已经不超上限——这种情况没有真正被藏起来的
  // 候选，"换话题"点了也不会变，得如实报 needsRotate:false（否则面板会挂一个按了没反应的死按钮）。
  const eligibleTotal = nonFillerCount + filler.length;
  if (eligibleTotal <= DIALOG_DISPLAY_CAP) {
    return { shown: [...fresh, ...seenNormal, ...filler], needsRotate: false };
  }

  const buckets = [fresh, seenNormal, filler];
  const nonEmptyCount = buckets.filter((b) => b.length > 0).length;
  const budget = nonEmptyCount > 1 ? DIALOG_DISPLAY_CAP - 1 : DIALOG_DISPLAY_CAP;

  const result: DialogChoice[] = [];
  const usedIds = new Set<string>();
  for (const bucket of buckets) {
    const room = budget - result.length;
    if (room <= 0) continue;
    const pool = randomize && bucket.length > room ? shuffle(bucket) : bucket;
    for (const c of pool.slice(0, room)) {
      result.push(c);
      usedIds.add(c.id);
    }
  }
  if (nonEmptyCount > 1) {
    const allBucketed = [...fresh, ...seenNormal, ...filler];
    const leftover = allBucketed.filter((c) => !usedIds.has(c.id));
    const pool2 = randomize ? shuffle(leftover) : leftover;
    if (pool2.length > 0) result.push(pool2[0]);
  }
  return { shown: result, needsRotate: true };
}
