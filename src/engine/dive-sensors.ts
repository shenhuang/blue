// 灯与声呐 wiring（#106 拆分自 dive.ts）：setLight / pingSonar（一记诚实 ping·感知重做 SPEC §2.2）。
// refreshSelection 收在此处——仅传感器切换后刷新选点预览。
// 声呐重做（车道 4·感知重做 SPEC §2.2「ping 才扫、不 ping 不扫」）：删掉「本回合开/关 + 预约下回合」双态状态机
// （setSonarNext / autoScanOnArrival / scan-on-open）——ping 是一记瞬时动作，付电 + 暴露、揭示规划纵深、不跨回合持续。

import type { GameState, RunState, Stalker } from '@/types';
import { appendLog } from './state';
import {
  sonarPingCost,
  ALERT_MAX,
  sonarPingAlertDelta,
} from './clarity';
import { revealSonarScan, sonarScanRange } from './sonar';
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
 * 一记声呐扫描的核心（感知重做 SPEC §2.2「更远的声呐 = 预判未来的选项」）：把从当前节点无向 BFS 到
 * sonarScanRange 跳的**所有节点**都记成「本回合被揭示到」（scanMemory[各节点]=本回合）——渲染层据此把这些
 * 「几跳之外」的节点画出来供规划（射程 = 看多远），并按几何圆做扩散揭示动画。同时快照猎手位置（听觉量程·§8.7·同一批节点）。
 * 纯揭示，**不动 power / alert / sensors**（由调用方 pingSonar 决定暴露与发射态）。
 */
function scanReveal(run: RunState): { scanMemory: Record<string, number>; stalker: Stalker | undefined } {
  const scanMemory: Record<string, number> = { ...run.scanMemory };
  // 一记 ping 揭示量程内的全部节点（规划纵深·SPEC §2.2）：BFS 到 sonarScanRange 跳、全 stamp 成本回合（含 origin）。
  if (run.map && run.currentNodeId) {
    for (const id of revealSonarScan(run.map, run.currentNodeId, sonarScanRange(run))) {
      scanMemory[id] = run.turn;
    }
  }
  // 猎手 SPEC §2.1/§8.7：听到猎手（听觉量程内 + 未躲过·同一记 ping）→ 刷新它在声呐图上的（会过时的）位置；没听到/躲过 → 原样。
  const stalker = run.stalker ? scanStalker(run, run.stalker) : undefined;
  return { scanMemory, stalker };
}

/**
 * 发一记声呐 ping（感知重做 SPEC §2.2「ping 才扫、不 ping 不扫」）：耗一大口电 + 当场抬警觉尖峰（loud 主动暴露），
 * 从当前节点揭示 sonarScanRange 跳之外的节点供规划（诚实远场侦察·永不撒谎）。需已解锁 + 有电 + 这一站还没扫过。
 * ping 是一记瞬时动作——移动后 sonar 归 off（不跨回合持续·旧双态开/关状态机已删）。
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
  const pingCost = sonarPingCost(run); // 升级派生（缺省 SONAR_PING_COST）
  if (run.power < pingCost) {
    return appendLog(state, { tone: 'realistic', text: '电量不够再发一记声呐了。' });
  }
  const power = Math.max(0, run.power - pingCost);
  const { scanMemory, stalker } = scanReveal(run);
  // 扫描当场抬警觉尖峰（暴露双刃，SPEC §5）：浅水免压、深 band 更狠。
  const alert = Math.min(ALERT_MAX, run.alert + sonarPingAlertDelta(run));
  let s: GameState = {
    ...state,
    run: {
      ...run,
      power,
      alert,
      scanMemory,
      stalker,
      // 本回合发过一记 ping（sonar='ping'·付电 + 暴露）；移动后 applyTransit 归 off（脉冲瞬时）。
      sensors: { ...run.sensors, sonar: 'ping' },
    },
  };
  s = appendLog(s, {
    tone: 'uncanny',
    text: '你发出一记脉冲。回波荡了回来，前方的水路在图上凿出了轮廓。',
  });
  return refreshSelection(s);
}
