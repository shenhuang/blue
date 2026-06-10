// 节点动作（#106 拆分自 dive.ts）：exploreFeature（房内连探付氧）/ restAtNode / breatheAtAirPocket / campAtNode。
// 连探标记 featureDoneFlag 与 dive-select 共用。
// 作者 06-10：rest/camp 改走 passTurnsWithStalker（猎手同拍推进·接触＝伏击中断不发收益）；
// exploreFeature **保持**裸 tickTurns——「连探的代价延迟到下次移动兑现」是成文设计（见其注释），动它需作者另拍。

import type { GameState } from '@/types';
import { tickTurns } from './events';
import { appendLog } from './state';
import { executeDeath } from './death';
import { featureDoneFlag } from './dive-select';
import { passTurnsWithStalker } from './dive-stalker';

/**
 * 多事件房间里「凑近探一处 feature」的回合开销（声呐与房间 SPEC §6/§8「连探付氧」）。
 * 不含洋流移动费（你没离开房间）——只是房内挪近、细看的时间。小值＝连探不致命，但每探都耗氧，
 * 形成「再翻一处还是趁早走」的张力（press-your-luck）。
 */
const FEATURE_EXPLORE_TURNS = 1;

/**
 * 探索当前房间里的一个 feature（多事件房间 S1）。在房内凑近细看：
 *   - 付 FEATURE_EXPLORE_TURNS 回合的氧（不含洋流移动费——你没离开房间）；
 *   - 标记已探（run.activeFlags，回到 enterNodeSelection 时该 feature 不再列出）；
 *   - 触发其事件。
 * 与「移动到新节点」解耦：不切 currentNodeId、不触发接近遭遇（探测只在跨节点 moveToNode 触发——
 * 但连探累积的 alert 会在你**下一次移动**时兑现，故「在大房间里翻太久」自有代价）。
 */
export function exploreFeature(state: GameState, featureId: string): GameState {
  const run = state.run;
  if (!run || !run.map || !run.currentNodeId) return state;
  const node = run.map.nodes[run.currentNodeId];
  const feat = node?.features?.find((f) => f.id === featureId);
  if (!feat) return state;
  const doneFlag = featureDoneFlag(node.id, feat.id);
  if (run.activeFlags.has(doneFlag)) return state; // 已探过（守卫，避免重复触发同一 feature）

  // 连探付氧：房内挪近这处、细看（耗回合 + 灯/声呐随 tick 耗电、深水抬 alert）。标记已探。
  const ticked = tickTurns(run, FEATURE_EXPLORE_TURNS);
  const activeFlags = new Set(ticked.activeFlags);
  activeFlags.add(doneFlag);
  let s: GameState = { ...state, run: { ...ticked, activeFlags } };

  // 氧气/理智死亡判定（与 moveToNode 同口径——连探也会把氧/理智耗到见底）
  if (s.run!.stats.oxygen <= 0) return executeDeath(s, '氧气耗尽，溺亡');
  if (s.run!.stats.sanity <= 0) return executeDeath(s, '理智崩溃，疯狂上浮');

  return { ...s, phase: { kind: 'dive', subPhase: { kind: 'event', eventId: feat.eventId } } };
}

/**
 * 休息节点：消耗 N 回合换体力恢复。
 * 作者 06-10：休息不再对猎手「免费」——passTurnsWithStalker 逐回合同拍推进（它逼近/扑诱饵/守口/放弃照常走）；
 * 被它摸上来＝伏击开打、觉没睡完 → 不补体力不发「调整呼吸」叙事（interrupted 短路）。
 */
export function restAtNode(state: GameState, turns: number = 3): GameState {
  let s = state;
  if (!s.run) return s;
  const passed = passTurnsWithStalker(s, turns);
  s = passed.state;
  if (passed.interrupted || !s.run) return s;
  const run = s.run;
  const stats = {
    ...run.stats,
    stamina: Math.min(run.staminaMax, run.stats.stamina + 15),
  };
  s = { ...s, run: { ...run, stats } };
  s = appendLog(s, { tone: 'realistic', text: `你停在此处，调整呼吸。体力恢复 +15。` });
  return s;
}

/**
 * 气穴换气：恢复氧气 + 一点理智，不耗回合（一瞬间的事）。
 * 一次性——用过把节点记进 `run.activeFlags`（`air_used:<nodeId>`），重访不再生效，
 * 避免迷路图里来回蹭气穴刷无限氧气。
 */
export function breatheAtAirPocket(state: GameState): GameState {
  let s = state;
  const run = s.run;
  if (!run || !run.currentNodeId) return s;
  const usedFlag = `air_used:${run.currentNodeId}`;
  if (run.activeFlags.has(usedFlag)) {
    return appendLog(s, { tone: 'realistic', text: '气穴已经被你吸空了，水面不再晃。' });
  }
  const oxygen = Math.min(run.oxygenMax, run.stats.oxygen + 6);
  const sanity = Math.min(100, run.stats.sanity + 4);
  const activeFlags = new Set(run.activeFlags);
  activeFlags.add(usedFlag);
  s = { ...s, run: { ...run, stats: { ...run.stats, oxygen, sanity }, activeFlags } };
  s = appendLog(s, {
    tone: 'realistic',
    text: '你的头露出水面。空气有股陈年的金属味，但能用。你深吸了几口。（氧气 +6 / 理智 +4）',
  });
  return s;
}

/**
 * 扎营点休整：短 / 长两档，消耗回合换体力 + 理智（长档还排掉一点氮）。
 * 可重复——但 tick 的耗氧是自带代价（与普通 rest 同理，洞里氧气是硬上限）。
 * 作者 06-10：同 restAtNode——猎手同拍推进，被摸上来＝开打且不发任何休整收益（觉没扎完）。
 */
export function campAtNode(state: GameState, mode: 'short' | 'long'): GameState {
  let s = state;
  if (!s.run) return s;
  const turns = mode === 'long' ? 6 : 3;
  const staGain = mode === 'long' ? 30 : 15;
  const sanGain = mode === 'long' ? 10 : 5;
  const n2Drop = mode === 'long' ? 5 : 0;
  const passed = passTurnsWithStalker(s, turns);
  s = passed.state;
  if (passed.interrupted || !s.run) return s;
  const run = s.run;
  const stats = {
    ...run.stats,
    stamina: Math.min(run.staminaMax, run.stats.stamina + staGain),
    sanity: Math.min(100, run.stats.sanity + sanGain),
    nitrogen: Math.max(0, run.stats.nitrogen - n2Drop),
  };
  s = { ...s, run: { ...run, stats } };
  s = appendLog(s, {
    tone: 'realistic',
    text:
      mode === 'long'
        ? `你关掉灯，认真扎了一会儿。重新打开灯时状态好多了。（${turns} 回合 · 体力 +${staGain} · 理智 +${sanGain} · 氮气 −${n2Drop}）`
        : `你卡住自己，听着呼吸。${turns} 回合后再起身，膝盖松了些。（体力 +${staGain} · 理智 +${sanGain}）`,
  });
  return s;
}
