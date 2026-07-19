// 灯与声呐 wiring（#106 拆分自 dive.ts）：setLight / pingSonar（一记诚实 ping·感知重做 SPEC §2.2）。
// refreshSelection 收在此处——仅传感器切换后刷新选点预览。
// 声呐重做（车道 4·感知重做 SPEC §2.2「ping 才扫、不 ping 不扫」）：删掉「本回合开/关 + 预约下回合」双态状态机
// （setSonarNext / autoScanOnArrival / scan-on-open）——ping 是一记瞬时动作，付电 + 暴露、全图揭示、不跨回合持续
// （声呐无升级化 2026-07-19：无射程无升级·一记 ping 整图全亮、移动全灰·见 engine/sonar.ts 头注）。

import type { GameState } from '@/types';
import { appendLog } from './state';
import {
  SONAR_PING_COST,
  ALERT_MAX,
  sonarPingAlertDelta,
} from './clarity';
import { scanStalker } from './stalker';
import { enterNodeSelection } from './dive-select';

/** 选点期若在 nodeSelect，重算预览（切灯 / ping 后刷新；其它 phase 原样返回）。 */
function refreshSelection(state: GameState): GameState {
  if (state.phase.kind === 'dive' && state.phase.subPhase.kind === 'nodeSelect') {
    return enterNodeSelection(state);
  }
  return state;
}

/**
 * 切换探照灯（深水区 Phase 0a）。开＝灯有效时近距真相 + 解锁信息，但抬高 signature（被探测，0b 接战斗）；
 * 关＝省电、最隐蔽，但盲。主动感知是双向的——看清世界＝把自己暴露给世界。
 */
export function setLight(state: GameState, on: boolean): GameState {
  const run = state.run;
  if (!run) return state;
  if (run.sensors.light === on) return state;
  // litThisTurn（#118）：开灯即记「本回合见过光」，结算时按整回合开灯收电费（关灯不清——
  // 这正是堵的那条缝）；回合 tick 后由 tickTurns 复位。
  let s: GameState = {
    ...state,
    run: { ...run, sensors: { ...run.sensors, light: on, ...(on ? { litThisTurn: true } : {}) } },
  };
  s = appendLog(s, {
    tone: 'realistic',
    text: on
      ? '你打开探照灯，一柱光劈进水里。'
      : '你关掉灯。黑暗合拢上来——但你也不再是黑水里那么扎眼的一团亮。',
  });
  return refreshSelection(s);
}

/**
 * 发一记声呐 ping（声呐无升级化·2026-07-19「一记 ping = 全图揭示」）：耗一大口电 + 当场抬警觉尖峰（loud 主动暴露），
 * 把**整张图**收进来（诚实侦察·永不撒谎·无射程）——记 lastScanTurn（迷雾黑→亮/灰的班次）+ 全图必闻快照猎手
 * （scanStalker·仍可被 evade）。需已解锁 + 有电 + 这一站还没扫过。
 * ping 是一记瞬时动作——移动后 sonar 归 off（不跨回合持续）＝图从全亮落回全灰（信息过期·想刷新＝到站再 ping）。
 */
export function pingSonar(state: GameState): GameState {
  const run = state.run;
  if (!run) return state;
  if (!run.sensors.sonarUnlocked) {
    return appendLog(state, { tone: 'system', text: '你还没有能用的声呐。' });
  }
  // 1 scan / 停留（声呐与房间 SPEC §8「1 scan/turn」）：这一站已 ping 过 → 不重复耗电/暴露。
  if (run.sensors.sonar === 'ping') {
    return appendLog(state, { tone: 'system', text: '脉冲还在水里荡，等它散了再扫一记。' });
  }
  if (run.power < SONAR_PING_COST) {
    return appendLog(state, { tone: 'realistic', text: '电量不够再发一记声呐了。' });
  }
  const power = Math.max(0, run.power - SONAR_PING_COST);
  // 猎手 SPEC §2.1/§8.7（全图必闻）：每记 ping 快照猎手位置（除非被 evade）；快照仍会过期（红点是旧影）。
  const stalker = run.stalker ? scanStalker(run, run.stalker) : undefined;
  // 扫描当场抬警觉尖峰（暴露双刃，SPEC §5）：浅水免压、深 band 更狠。
  const alert = Math.min(ALERT_MAX, run.alert + sonarPingAlertDelta(run));
  let s: GameState = {
    ...state,
    run: {
      ...run,
      power,
      alert,
      // 全图迷雾班次（黑→有记·SonarScanPanel 读）：undefined＝从未扫过（全黑）。
      lastScanTurn: run.turn,
      stalker,
      // 这一站发过一记 ping（sonar='ping'·付电 + 暴露·全亮 fresh 位 + 声呐门活条件）；移动后 applyTransit 归 off。
      sensors: { ...run.sensors, sonar: 'ping' },
    },
  };
  s = appendLog(s, {
    tone: 'uncanny',
    text: '你发出一记脉冲。回波从四面八方荡了回来，整片水域在图上凿出了轮廓。',
  });
  return refreshSelection(s);
}
