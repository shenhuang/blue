// 具名 phase 转移 —— phase 构造权收归 engine（品味评审候选②·CHANGELOG #107）。
//
// 此前 ui/ 12 处手搓 `phase: { kind: ... }` 字面量（EventView/RestView/CombatView/
// NodeSelectView 各拼一份「上浮」……），phase 形状一改就要全 ui 找一遍。收口后：
//   - UI 只调这里的具名转移，语义自文档（beginAscent ≠ 「ascent 字面量到处长」）；
//   - src/ui 禁 phase 字面量由 scripts/check-boundaries.mjs 规则二强制（会红的门，
//     非散文约定）；engine 内部构造 phase 不受限——它是 owner。
//
// 命名注记：回港的「结算」入口是 port.ts::handleReturnToPort（合并 inventory/触发
// cutscene）；这里的 toPort 只是纯导航（关店/收图/葬礼毕），刻意不叫 returnToPort
// 避免语义撞名。
//
// 全部纯函数：GameState in → GameState out，不触 RNG / 不读全局。

import type { GameState, DiveSubPhase } from '@/types';

/** 纯导航回港口主界面（关店 / 收海图 / 葬礼看完 / 港口 cutscene 完）。
 *  不做回港结算 —— 上岸结算走 port.ts::handleReturnToPort。 */
export function toPort(state: GameState): GameState {
  return { ...state, phase: { kind: 'port' } };
}

/** 开始上浮回水面（选点处主动上浮 / 休整点上浮 / 战斗应急上浮 / 事件强制上浮）。
 *  returnTo＝主动上浮时来处的 dive 子阶段（NodeSelect / Rest），只主动上浮路径传——给上浮界面
 *  一个「取消」回退点；战斗应急 / 事件强制 / 走到死路的自动上浮不传 → 上浮界面不出取消按钮（不可反悔）。 */
export function beginAscent(state: GameState, returnTo?: DiveSubPhase): GameState {
  return {
    ...state,
    phase: { kind: 'ascent', targetDepth: 0, ...(returnTo ? { returnTo } : {}) },
  };
}

/** 从上浮界面「取消」回到主动上浮的来处子阶段（returnTo 由 beginAscent 捕获）。
 *  非 ascent 阶段或无 returnTo（forced 上浮）→ 原样返回（取消按钮本就不渲染·判定单点收在引擎）。 */
export function cancelAscent(state: GameState): GameState {
  if (state.phase.kind !== 'ascent' || !state.phase.returnTo) return state;
  return { ...state, phase: { kind: 'dive', subPhase: state.phase.returnTo } };
}

/** 港口 → 商店。 */
export function toShop(state: GameState, shopId: string): GameState {
  return { ...state, phase: { kind: 'shop', shopId } };
}

/** 港口 → 海图选点。 */
export function toChart(state: GameState): GameState {
  return { ...state, phase: { kind: 'chart' } };
}

/** 下潜中进入 / 续接一个事件（事件链 continueEvent 等）。 */
export function toDiveEvent(state: GameState, eventId: string): GameState {
  return {
    ...state,
    phase: { kind: 'dive', subPhase: { kind: 'event', eventId } },
  };
}

/** 死亡 → gameOver（reason 为玩家可见文案，由调用方给）。 */
export function toGameOver(state: GameState, reason: string): GameState {
  return { ...state, phase: { kind: 'gameOver', reason } };
}
