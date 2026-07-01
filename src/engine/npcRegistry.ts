// NPC 数据文件单一登记表（#244 提炼）——原先 dialog.ts 和 trust.ts 各自硬编码一份
// `[aldoData, miraData, ottoData]` 的 import 列表，加 Silas 时两处都要记得改一个明显的重复维护点
// （trust.ts 那份漏改过一次·debug 才发现「攒够信任但 tier 不涨」——thresholds 表没扫到 silas.json）。
// 收口成这一处：新增 NPC 只在这里注册一次，dialog.ts（对话树索引）与 trust.ts（信任阈值表）都读它，
// 不会再有「一处加了 NPC、另一处忘记」的漂移。

import type { NpcDef, DialogNode } from '@/types';
import aldoData from '@/data/npcs/aldo.json';
import miraData from '@/data/npcs/mira.json';
import ottoData from '@/data/npcs/otto.json';
import silasData from '@/data/npcs/silas.json';

export interface NpcFile {
  npc: NpcDef;
  dialogs?: Record<string, DialogNode>;
}

export const NPC_FILES: NpcFile[] = [
  aldoData as unknown as NpcFile,
  miraData as unknown as NpcFile,
  ottoData as unknown as NpcFile,
  silasData as unknown as NpcFile,
];
