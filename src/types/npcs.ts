// NPC schema —— 港口对话与互动

export type NpcRole =
  | 'mentor' // 守灯人 Aldo
  | 'merchant' // 打捞商 Mira
  | 'engineer' // 气瓶师 Otto
  | 'priest' // 教堂线（后期）
  | 'guildmaster' // 公会
  | 'librarian' // 图书室（后期）
  | 'trader'; // 交易者（原特殊商人角色·该 NPC 已随藏宝线移除·角色保留供将来用）

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
  /**
   * 同功能冗余（对话选项面板收窄·作者 2026-07-03 拍板）：这条选项跟别处已有的常驻入口做同一件事——
   * 比如 Mira 的"把材料摊在柜台上"跟 NPC 卡片上的"直接找她卖东西"按钮重复、Aldo 的"摊开海图"跟港口
   * 常驻底部"摊开海图（出海）"按钮重复。标 true 后这条选项只在「新 + 已聊」两档凑不满显示上限时才补位
   * （够了就整条从候选池摘掉，不是排队等轮到）——见 engine/dialog.ts::selectDisplayChoices。
   * 不填＝当普通选项（新/已聊分档仍照常算）。**"下次再说/没事先这样"这类通用退出选项别标此字段**——
   * 对话面板没有常驻关闭按钮（作者 2026-07-03 拍：位置错位，删；靠对话选项本身关闭就够），标了会导致
   * 它被同功能挤出候选池，真的关不掉对话。
   */
  filler?: boolean;
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
  | { kind: 'openUpgradeTree'; lineId: string }
  | { kind: 'gainTrust'; npcId: string; amount: number } // 唯一写口经 engine/trust.ts::gainTrust（规则七·别在别处直写该信任字段）
  | { kind: 'takeItem'; itemId: string; qty: number };
