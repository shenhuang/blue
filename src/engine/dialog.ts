// 对话引擎 —— 港口 NPC 对话
// 数据按 NPC 拆分在 src/data/npcs/<npcId>.json，引擎只做"按 id 取节点"和"应用 effect"

import type { GameState, DialogNode, DialogChoice, DialogEffect, NpcDef } from '@/types';
import aldoData from '@/data/npcs/aldo.json';
import miraData from '@/data/npcs/mira.json';
import { createNewRun } from './state';
import { startDive } from './dive';
import { getRunBonuses } from './lighthouses';

interface NpcFile {
  npc: NpcDef;
  dialogs?: Record<string, DialogNode>;
}

const NPC_FILES: NpcFile[] = [aldoData as unknown as NpcFile, miraData as unknown as NpcFile];

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
        const bonuses = getRunBonuses(s.profile);
        const run = createNewRun({
          zoneId: e.zoneId,
          bonuses: {
            oxygenMaxBonus: bonuses.oxygenMaxBonus,
            staminaMaxBonus: bonuses.staminaMaxBonus,
            extraConsumableSlot: bonuses.extraConsumableSlot,
            sonarUnlocked: bonuses.sonarUnlocked,
          },
        });
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
      case 'giveItem':
      case 'openUpgradeTree':
        // TODO 实现：直接给物品、升级树面板（Mira 之外的店暂未实现）
        break;
    }
  }
  return s;
}

export function selectChoice(
  state: GameState,
  _current: DialogNode,
  choice: DialogChoice
): { state: GameState; next: DialogNode | null } {
  const s = applyDialogEffects(state, choice.effects);
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
