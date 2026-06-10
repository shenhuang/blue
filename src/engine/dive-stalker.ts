// 猎手与伏击 wiring（#106 拆分自 dive.ts·纯搬移）：旧瞬时伏击（maybeApproachEncounter）/ 猎手一步
// （stalkerStep·Phase 1）/ 停下迎战（standAndFight·§5）。供 dive-move 在移动时调用。函数体与拆分前逐字相同。

import type { GameState, DiveNode } from '@/types';
import { getZone } from './zones';
import { appendLog } from './state';
import { startCombat } from './combat';
import { predatorApproaches, ALERT_AFTER_TRIGGER } from './clarity';
import { maybeSpawnStalker, advanceStalker } from './stalker';

/**
 * 深水区 Phase 0b：警觉越线 → 潜伏的捕食者接近、触发遭遇。
 * 仅当该 zone 配了 `ambushEncounters` + 警觉够 + 够深（§7.5）+ 进入的是非地标节点（事件/尸体）时触发——
 * 地标（上浮口/气穴/扎营）是落脚点，不在此被伏击，总留「摸黑奔向出口」的出路。
 * 选遭遇用确定性索引（不消耗 Math.random，保 mapgen/场景确定性）。返回 combat 态 GameState，否则 null。
 */
export function maybeApproachEncounter(state: GameState, target: DiveNode): GameState | null {
  const run = state.run;
  if (!run) return null;
  if (!predatorApproaches(run)) return null;
  if (target.kind !== 'event' && target.kind !== 'corpse') return null;
  const pool = getZone(run.zoneId)?.ambushEncounters;
  if (!pool || pool.length === 0) return null;
  const combatId = pool[run.visitedNodeIds.length % pool.length];
  // 触发后警觉落回缓冲值，避免连环伏击
  let s: GameState = { ...state, run: { ...run, alert: ALERT_AFTER_TRIGGER } };
  s = appendLog(s, {
    tone: 'uncanny',
    text: '你举着的光招来了东西——它从黑里径直朝你来，没有半点犹豫。',
  });
  return startCombat(s, combatId);
}

/**
 * 猎手一步（猎手 SPEC Phase 1·仅 run.huntEnabled 的深 band 走这条）：把高警觉遭遇从「当场瞬时伏击」
 * 升成「有位置的逼近猎手」。返回 { state, contact }——contact=true 时 state 已是伏击 combat 态（moveToNode 提前返回）；
 * 否则 state 是更新了 run.stalker（现身 / 逼近 / 信号切断后搜 / 跟丢 despawn）+ 叙事的 dive 态，moveToNode 照常进节点。
 *   - 已有猎手 → advanceStalker 推进一回合：接触到你 → 触发现有伏击遭遇（复用 ambushEncounters·不加新敌）。
 *   - 无猎手 + 越线（predatorApproaches·同旧触发线）→ 在声呐量程外现身（不当场伏击·给读出来+反应的窗口）。
 * 仅进入事件/尸体节点时（地标是落脚点·不伏击·留「摸黑奔向出口」的出路·同旧路径）。
 */
export function stalkerStep(
  state: GameState,
  target: DiveNode,
  fromNodeId?: string,
): { state: GameState; contact: boolean } {
  const run = state.run;
  if (!run || !run.map) return { state, contact: false };
  if (target.kind !== 'event' && target.kind !== 'corpse') return { state, contact: false };

  if (run.stalker) {
    // fromNodeId＝玩家这回合刚离开的节点（对穿接触判定·§5）。
    const { stalker: next, contact } = advanceStalker(run, run.stalker, fromNodeId);
    if (contact && next) {
      // 接触 → 触发现有伏击遭遇（复用 zone 的 ambushEncounters）；清猎手 + 警觉落缓冲（避免连环）。
      let s: GameState = { ...state, run: { ...run, stalker: undefined, alert: ALERT_AFTER_TRIGGER } };
      s = appendLog(s, { tone: 'uncanny', text: '黑里那个东西终于赶上了你——它一直循着你，没有半点犹豫。' });
      return { state: startCombat(s, next.encounterId), contact: true };
    }
    let s: GameState = { ...state, run: { ...run, stalker: next ?? undefined } };
    s = appendLog(
      s,
      next
        ? {
            tone: 'uncanny',
            text:
              next.state === 'searching'
                ? '水里那东西没了你的信号，却没走——它在你最后惊动它的地方附近，慢慢摸。'
                : '它又近了一点。你听得见自己心跳盖过回波。',
          }
        : { tone: 'realistic', text: '你屏住光和声，沉进黑里。过了一会儿——那股一直跟着你的注意，散了。' },
    );
    return { state: s, contact: false };
  }

  // 无猎手：越线才现身（同 predatorApproaches 触发线·但不当场伏击）。
  if (!predatorApproaches(run)) return { state, contact: false };
  const pool = getZone(run.zoneId)?.ambushEncounters ?? [];
  const spawned = maybeSpawnStalker(run, pool);
  if (!spawned) return { state, contact: false };
  let s: GameState = { ...state, run: { ...run, stalker: spawned } };
  s = appendLog(s, {
    tone: 'uncanny',
    text: '黑水深处，有什么离开了它待着的地方，朝你这边来了——还远，但它知道你在哪。',
  });
  return { state: s, contact: false };
}

/** 迎战先手暴击倍率（猎手 SPEC §5「选择迎战给先手优势」·与 combat ambush 默认同档）。 */
const STAND_FIGHT_MULT = 1.5;

/**
 * 停下·迎战（猎手 SPEC §5）：有猎手时玩家主动开打——在你的条件下接战，先手 ambushing 暴击（对比被追上时的被动伏击吃亏）。
 * 复用该猎手的 encounterId（zone ambushEncounters·不加新敌）；清猎手 + 警觉落缓冲（同接触后处理·避免连环）。无猎手 → 原样。
 */
export function standAndFight(state: GameState): GameState {
  const run = state.run;
  if (!run || !run.stalker) return state;
  const encounterId = run.stalker.encounterId;
  let s: GameState = { ...state, run: { ...run, stalker: undefined, alert: ALERT_AFTER_TRIGGER } };
  s = appendLog(s, {
    tone: 'realistic',
    text: '你不再退——稳住身体，把光对准黑暗里那东西，抢在它扑上来之前先发制人。',
  });
  return startCombat(s, encounterId, [{ kind: 'ambushing', remaining: 2, param: STAND_FIGHT_MULT }]);
}
