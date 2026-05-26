// 对话引擎 —— 港口 NPC 对话
// 数据结构在 src/data/npcs.json 中，引擎只做"按 id 取节点"和"应用 effect"

import type { GameState, DialogNode, DialogChoice, DialogEffect } from '@/types';
import npcData from '@/data/npcs.json';
import { createNewRun } from './state';
import { startDive } from './dive';

interface NpcsFile {
  npcs: Array<{ id: string; name: string; role: string; shortDescription: string; dialogRoot: DialogNode }>;
  dialogs: Record<string, DialogNode>;
}

const file = npcData as unknown as NpcsFile;

const DIALOG_INDEX: Map<string, DialogNode> = new Map();
for (const npc of file.npcs) {
  DIALOG_INDEX.set(npc.dialogRoot.id, npc.dialogRoot);
}
for (const [id, node] of Object.entries(file.dialogs)) {
  DIALOG_INDEX.set(id, node);
}

export function getNpc(id: string) {
  return file.npcs.find((n) => n.id === id);
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
        const run = createNewRun({ zoneId: e.zoneId });
        s = { ...s, run };
        s = startDive(s, e.zoneId);
        break;
      }
      case 'giveItem':
      case 'openShop':
      case 'openUpgradeTree':
        // TODO 实现：开店面板、升级树面板
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
