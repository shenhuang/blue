// NPC schema —— 港口对话与互动

export type NpcRole =
  | 'mentor' // 守灯人 Aldo
  | 'merchant' // 打捞商 Mira
  | 'engineer' // 气瓶师 Otto
  | 'priest' // 教堂线（后期）
  | 'guildmaster' // 公会
  | 'librarian' // 图书室（后期）
  | 'trader'; // 特殊商人 Silas（藏宝贸易与信任系统 SPEC §6·探险家镜像·token+信任门控货架）

export interface NpcDef {
  id: string;
  name: string;
  role: NpcRole;
  /** 港口画面上 NPC 显示的简短描述 */
  shortDescription: string;
  /** 对话树根节点 */
  dialogRoot: DialogNode;
  /**
   * 通用信任系统 per-NPC 档阈值（藏宝贸易与信任系统 SPEC §3.2/§3.6·可选·Phase 1 无 NPC 设置）。
   * thresholds[i] = 到第 i+1 档所需信任值（单调递增·check-npc-trust 守）；缺则用 engine/trust.ts 默认梯。
   * 数值 defer-number-tuning。将来阵营（§3.9）在此加 faction?: string。
   */
  trust?: { thresholds: number[] };
}

/** 对话节点 —— 树状结构 */
export interface DialogNode {
  id: string;
  /** NPC 说的话；可空（仅提供选项分支时） */
  text?: string;
  /** 玩家可选的回应；空数组 = 对话结束（按"再见"返回） */
  choices?: DialogChoice[];
  /** 进入此节点时的副作用（设置 flag、给物品、开启升级、开始下潜...） */
  onEnter?: DialogEffect[];
}

export interface DialogChoice {
  id: string;
  label: string;
  visibleIf?: import('./events').Condition;
  /** 跳转到的下一个 DialogNode id，或 'end' 关闭对话 */
  next: string | 'end';
  effects?: DialogEffect[];
}

export type DialogEffect =
  | { kind: 'setFlag'; flag: string }
  | { kind: 'removeFlag'; flag: string }
  | { kind: 'giveItem'; itemId: string; qty: number }
  | { kind: 'takeGold'; amount: number }
  | { kind: 'giveGold'; amount: number }
  | { kind: 'startDive'; zoneId: string }
  | { kind: 'openChart' } // 摊开港口海图选点（切 phase 'chart'）
  | { kind: 'openShop'; shopId: string }
  | { kind: 'openUpgradeTree'; lineId: string };
