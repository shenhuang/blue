// 战斗状态系统 —— 单一源类型（深海回响_战斗状态系统_SPEC.md §2.1）
// 玩家↔敌↔敌对称共用：同一份数据形状、同一个结算函数（engine/status.ts::settleStatusesAtTurnStart）。
// 落新文件而非塞进 enemies.ts / combat.ts：两者都要 import 本类型，塞任一方会造成互相 import 的类型环。

export type StatusKind = 'stunned' | 'bleeding' | 'poisoned'; // v1 目录·有内容需求再扩

export interface StatusInstance {
  kind: StatusKind;
  /** 该角色「自己的回合」计数（settleStatusesAtTurnStart 每回合开头 -1，归零移除）。 */
  remainingTurns: number;
  /** DoT 每回合伤（潜力值/potency）；二值状态（stunned）不用，缺省视为 0。 */
  dmgPerTurn?: number;
}
