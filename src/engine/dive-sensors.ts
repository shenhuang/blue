// 灯与声呐 wiring（#106 拆分自 dive.ts·纯搬移）：setLight / pingSonar（定向 §5）/ setSonarNext（§4 预承诺）/
// scan-on-open（autoScanOnArrival·供 dive-move 到站调用）。refreshSelection 收在此处——仅传感器切换后刷新选点预览。
// 函数体与拆分前逐字相同。

import type { GameState, RunState, Stalker } from '@/types';
import { appendLog } from './state';
import {
  sonarPingCost,
  ALERT_MAX,
  sonarPingAlertDelta,
  sonarStandingNext,
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
 * 发一记声呐 ping（深水区 Phase 0a）：耗一大口电，本次选点改读"不可信的声呐返回"（≠ 真内容）。
 * 需已解锁声呐能力（后期深料升级）；电量不足则只叙事不消费。移动后 ping 自动消散（脉冲是瞬时的）。
 *
 * 定向 ping（声呐与房间 SPEC §5·作者 2026-06-06 拍板「方向扇区」）：dir 给出时把波束朝一个扇区聚焦——
 * 那个扇区探更远、别处更短（revealSonarScanDirectional），且暴露按方向计（sonarPingAlertDelta(run,dir)：
 * 整体更安静、但正对声感猎手则尖峰）。**dir 缺省＝全向，与旧行为逐字节一致**。猎手定位仍按基线量程（你
 * 总听得到近场的它），只是「看到的洞」和「招来的注意」随方向变。
 */
/**
 * 一次声呐扫描的核心（几何圆揭示·作者 06-13 重设计）：把**当前所在节点**记成「本回合的扫描中心」
 * （scanMemory[当前节点]=本回合）——渲染层据此画出以你为心、半径 SONAR_REVEAL_R 的揭示圆。
 * 同时快照猎手位置（听觉量程·§8.7）。纯揭示，**不动 power / alert / sensors**（由调用方决定暴露与开关态）。
 */
function scanReveal(run: RunState): { scanMemory: Record<string, number>; stalker: Stalker | undefined } {
  const scanMemory: Record<string, number> = { ...run.scanMemory };
  // 只盖**当前节点**＝这一站、这一回合的扫描中心（渲染按所有中心 + 半径画几何圆；移动到新节点再扫＝新中心·#1）。
  if (run.currentNodeId) scanMemory[run.currentNodeId] = run.turn;
  // 猎手 SPEC §2.1/§8.7：听到猎手（听觉量程内 + 未躲过）→ 刷新它在声呐图上的（会过时的）位置；没听到/躲过 → 原样。
  const stalker = run.stalker ? scanStalker(run, run.stalker) : undefined;
  return { scanMemory, stalker };
}

/**
 * 发一记声呐扫描（深水区 Phase 0a + 声呐渲染重做 §4「本回合反悔」）：耗一大口电 + 当场抬警觉尖峰（loud 主动暴露），
 * 以你当前节点为心点亮一块揭示圆。需已解锁 + 有电 + 这一站还没扫过。声呐关时也可用＝「本回合反悔扫一记」
 * （扫了就算本回合开·付暴露·之后再设关只影响下回合）——开/关切换的「关着点开＝立即扫」也走这里。
 */
export function pingSonar(state: GameState): GameState {
  const run = state.run;
  if (!run) return state;
  if (!run.sensors.sonarUnlocked) {
    return appendLog(state, { tone: 'system', text: '你还没有能用的声呐。' });
  }
  // 1 scan / 停留（声呐与房间 SPEC §8「1 scan/turn」）：这一站已扫过（自动 scan-on-open 或手动）→ 不重复耗电/暴露。
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
      // 手动扫＝本回合发射（sonar='ping'）＝就算之前设了关也算本回合开（付暴露·§4 反悔）。
      sensors: { ...run.sensors, sonar: 'ping' },
    },
  };
  s = appendLog(s, {
    tone: 'uncanny',
    text: '你发出一记脉冲。回波荡了回来——只是你说不准能不能信它。',
  });
  return refreshSelection(s);
}

/**
 * scan-on-open（声呐渲染重做 SPEC §4）：声呐持续开时，到站自动扫一记（懒揭示·刷新成新图 + 快照猎手）。
 * 暴露由「持续开」本身承担（sonarActive 在回合 tick 里计 signature·见 alertDelta）——自动扫**不再加 ping 尖峰**（区别主动 ping 的 loud 暴露）。
 * 耗一记电（声呐费电）：电不够 → 声呐哑火转 off（旧图保留·留电管理张力）。仅 emitting（applyTransit 据 standing 落的 sonar==='ping'）时跑。
 */
export function autoScanOnArrival(state: GameState): GameState {
  const run = state.run;
  if (!run) return state;
  if (run.sensors.sonar !== 'ping') return state; // standing 关 / 未解锁 → 不自动扫（看旧图）
  const cost = sonarPingCost(run);
  if (run.power < cost) {
    // 电不够维持声呐 → 这一站哑火（落 off·旧图保留·暴露也随之停）。
    return { ...state, run: { ...run, sensors: { ...run.sensors, sonar: 'off' } } };
  }
  const power = Math.max(0, run.power - cost);
  const { scanMemory, stalker } = scanReveal(run); // 到站自动扫＝以新节点为心点亮揭示圆
  return { ...state, run: { ...run, power, scanMemory, stalker } };
}

/**
 * 切换声呐**下回合**开/关（声呐渲染重做 SPEC §4·玩家的控制点＝预承诺下一回合是否关）。
 * 只改 sonarNext，本回合开/关不变（已是上回合定的）；移动时 applyTransit 把 sonarNext 落成下回合的 sonarOn。
 * 本回合若想立刻看＝主动 pingSonar 反悔（付暴露）。未解锁 → 原样。
 */
export function setSonarNext(state: GameState, on: boolean): GameState {
  const run = state.run;
  if (!run || !run.sensors.sonarUnlocked) return state;
  if (sonarStandingNext(run) === on) return state;
  let s: GameState = {
    ...state,
    run: { ...run, sensors: { ...run.sensors, sonarNext: on } },
    profile: { ...state.profile, sonarOn: on }, // 跨 run 持久：记进 profile，下次落地（startDive）按它种声呐开关
  };
  s = appendLog(s, {
    tone: 'system',
    text: on
      ? '你决定下一段路把声呐开着——看得见，但也被听得见。'
      : '你决定下一段路关掉声呐——往黑里走，凭记忆里的旧图摸路。',
  });
  return s;
}
