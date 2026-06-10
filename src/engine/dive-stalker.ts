// 猎手与伏击 wiring（#106 拆分自 dive.ts·纯搬移）：旧瞬时伏击（maybeApproachEncounter）/ 猎手一步
// （stalkerStep·Phase 1）/ 停下迎战（standAndFight·§5）/ 投放诱饵（deployDecoy·§4）。供 dive-move 在移动时调用。

import type { GameState, DiveNode, DiveDecoy, RunState } from '@/types';
import { getZone } from './zones';
import { appendLog, removeFromInventory } from './state';
import { startCombat } from './combat';
import { getItemDef } from './items';
import { predatorApproaches, ALERT_AFTER_TRIGGER, ALERT_MIN_DEPTH } from './clarity';
import { maybeSpawnStalker, maybeSpawnWeakStalker, advanceStalker, activeDecoy, DECOY_TURNS } from './stalker';

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
  let run = state.run;
  if (!run || !run.map) return { state, contact: false };
  if (target.kind !== 'event' && target.kind !== 'corpse') return { state, contact: false };

  // 诱饵过期的顺手清扫（§4·语义本体在 activeDecoy 的 turn 判定，这里只是把哑掉的字段擦掉 + 一句叙事收尾）。
  // 仅在字段已存在且确实过期时碰 run（没投过诱饵 → run 原对象原样＝逐字节不变）。
  if (run.decoy && !activeDecoy(run)) {
    run = { ...run, decoy: undefined };
    state = appendLog({ ...state, run }, { tone: 'realistic', text: '你放出去的诱饵哑了——电用尽，沉进黑里。' });
  }

  if (run.stalker) {
    return advanceNarrated(state, run, run.stalker, fromNodeId);
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

/**
 * 推进既有猎手一回合并配叙事（stalkerStep / weakStalkerStep 共用）。叙事按 advanceStalker 的旗子分支：
 * 接触（伏击）/ 上钩（§4）/ 守口（§5/§6）/ 放弃（§6）/ 重新咬上（§2.2 active）/ 搜索 / 逼近 / 跟丢。
 * 不交底感官与机制（#54）——只给可读出的 tell。
 */
function advanceNarrated(
  state: GameState,
  run: RunState,
  stalker: NonNullable<RunState['stalker']>,
  fromNodeId?: string,
): { state: GameState; contact: boolean } {
  const weak = stalker.weak === true;
  const { stalker: next, contact, lured, guarding, gaveUp, reacquired } = advanceStalker(run, stalker, fromNodeId);
  if (contact && next) {
    // 接触 → 触发现有伏击遭遇（复用 zone 的 ambushEncounters）；清猎手 + 警觉落缓冲（避免连环）。
    let s: GameState = { ...state, run: { ...run, stalker: undefined, alert: ALERT_AFTER_TRIGGER } };
    s = appendLog(s, {
      tone: 'uncanny',
      text: weak
        ? '那个一直远远跟着的小东西终于贴了上来——不大，可牙是真的。'
        : '黑里那个东西终于赶上了你——它一直循着你，没有半点犹豫。',
    });
    return { state: startCombat(s, next.encounterId), contact: true };
  }
  let s: GameState = { ...state, run: { ...run, stalker: next ?? undefined } };
  s = appendLog(
    s,
    next
      ? {
          tone: 'uncanny',
          text: lured
            ? // §4：上钩——它追的是诱饵不是你（你读出这一拍＝反向拉开的窗口）。不写诱饵种类、不交底感官（#54）。
              '那股注意从你身上挪开了——它转向你放出的那点假动静，朝着别处去。'
            : reacquired
              ? // §2.2 active：你明明屏住了光和声，它还是找了过来——这是「它自己在探」的 tell（要甩它得靠装备/拉距）。
                '水里荡过一记不属于你的脉冲——你什么都没开，它还是把头转向了你这边。'
              : guarding
                ? // §5/§6：钻不进的家伙堵在窄口外。它的耐心在烧，你的氧也在烧。
                  '它在外面。太大了，挤不进这道缝——你听得见它蹭过岩壁的拖刮声，一圈，又一圈。它没打算走。'
                : next.state === 'searching'
                  ? '水里那东西没了你的信号，却没走——它在你最后惊动它的地方附近，慢慢摸。'
                  : weak
                    ? '那道小影子又跟近了一点，始终缀在你的光外缘。'
                    : '它又近了一点。你听得见自己心跳盖过回波。',
        }
      : gaveUp
        ? // §6：守口等够 patience 走人——与「跟丢」的安心不同，这是它「等不起了」。
          { tone: 'realistic', text: '外面那阵拖刮声停了。隔了很久——它终于等够了，那股庞大的注意散开，沉回黑里。' }
        : { tone: 'realistic', text: '你屏住光和声，沉进黑里。过了一会儿——那股一直跟着你的注意，散了。' },
  );
  return { state: s, contact: false };
}

/**
 * Q3 浅水弱变体一步（猎手 SPEC §2.6「浅水小且弱」·非 huntEnabled 的浅水旁路）。
 * 返回 null ＝本路径无事可做（调用侧 fall through 到旧 maybeApproachEncounter·逐字节不变）：
 * zone 没 opt-in（weakHunts）/ 不够浅（≥ ALERT_MIN_DEPTH 仍走旧瞬时伏击）/ 概率未中 / 非事件节点且无猎手。
 * 已有（弱）猎手 → 推进（advanceNarrated 共用）；接触触发该 zone 现有 ambushEncounters（小且弱＝浅水池本身）。
 * §7.5 不破：alert 仍不积累、predatorApproaches 仍恒假——弱变体读的是你的灯/声呐开关（weakStalkerHasSignal）。
 * 注：无猎手时不做诱饵过期清扫（best-effort——activeDecoy 的 turn 判定才是语义本体）。
 */
export function weakStalkerStep(
  state: GameState,
  target: DiveNode,
  fromNodeId?: string,
): { state: GameState; contact: boolean } | null {
  let run = state.run;
  if (!run || !run.map) return null;
  if (target.kind !== 'event' && target.kind !== 'corpse') return null;

  const existing = run.stalker;
  if (existing) {
    // 诱饵过期的顺手清扫（同 stalkerStep·仅字段已存在且确实过期时碰 run）。
    let s = state;
    if (run.decoy && !activeDecoy(run)) {
      run = { ...run, decoy: undefined };
      s = appendLog({ ...state, run }, { tone: 'realistic', text: '你放出去的诱饵哑了——电用尽，沉进黑里。' });
    }
    return advanceNarrated(s, run, existing, fromNodeId);
  }

  // 现身门：浅水线下（警觉积累不到的那段才归弱变体管）+ zone 数据 opt-in + 有池子 + 确定性小概率。
  if ((run.currentDepth ?? 0) >= ALERT_MIN_DEPTH) return null;
  const zone = getZone(run.zoneId);
  if (!zone?.weakHunts) return null;
  const spawned = maybeSpawnWeakStalker(run, zone.ambushEncounters ?? []);
  if (!spawned) return null;
  let s: GameState = { ...state, run: { ...run, stalker: spawned } };
  s = appendLog(s, {
    tone: 'uncanny',
    text: '浅水里有什么小东西缀上了你——不大，远远地吊着，不肯靠近，也不肯走。',
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

/**
 * 投放诱饵（猎手 SPEC §4）：从 run 背包烧掉一枚 decoy 道具，放在你**当前节点**、替你发声/发光
 * DECOY_TURNS 回合（expiresTurn = run.turn + DECOY_TURNS）。感官匹配的猎手会被引向诱饵点
 * （advanceStalker 的 decoy 分支）；感官不合 → 它不上钩，道具照样烧掉——你未必知道它靠什么找你（§2.1 的赌注）。
 * 不耗回合（代价＝道具本身·投完照常选路）；水里一次至多一枚（再投覆盖旧的）。投完别站在原地——它冲这儿来。
 * 非 dive 中 / 无图 / 道具不是 decoy / 背包没货 → 原样返回（UI 按钮按持有量门控，脚本可断言 no-op）。
 */
export function deployDecoy(state: GameState, itemId: string): GameState {
  const run = state.run;
  if (!run || !run.map || !run.currentNodeId) return state;
  const kind = getItemDef(itemId)?.decoy?.kind;
  if (!kind) return state;
  const have = run.inventory.find((i) => i.itemId === itemId)?.qty ?? 0;
  if (have <= 0) return state;

  const decoy: DiveDecoy = { nodeId: run.currentNodeId, kind, expiresTurn: run.turn + DECOY_TURNS };
  let s: GameState = {
    ...state,
    run: { ...run, inventory: removeFromInventory(run.inventory, itemId, 1), decoy },
  };
  s = appendLog(s, {
    tone: 'realistic',
    text:
      kind === 'sound'
        ? '你拧开声诱标放进水里。它开始低低地嗡——像一头受伤的东西在扑腾。别留在它旁边。'
        : '你折亮光诱棒卡进石缝。冷光一跳一跳地晃——黑水里最扎眼的就是它。走，趁现在。',
  });
  return s;
}
