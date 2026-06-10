// 灯与声呐 wiring（#106 拆分自 dive.ts·纯搬移）：setLight / pingSonar（定向 §5）/ setSonarNext（§4 预承诺）/
// scan-on-open（autoScanOnArrival·供 dive-move 到站调用）。refreshSelection 收在此处——仅传感器切换后刷新选点预览。
// 函数体与拆分前逐字相同。

import type { GameState, RunState, SonarDir, Stalker } from '@/types';
import { appendLog } from './state';
import {
  sonarPingCost,
  ALERT_MAX,
  sonarPingAlertDelta,
  sonarStandingNext,
} from './clarity';
import { revealSonarScanDirectional, sonarScanRange, sonarDirReach } from './sonar';
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
  if ((run.sensors?.light ?? true) === on) return state;
  let s: GameState = { ...state, run: { ...run, sensors: { ...run.sensors, light: on } } };
  s = appendLog(s, {
    tone: 'realistic',
    text: on
      ? '你打开探照灯，一柱光劈进水里。'
      : '你关掉灯。黑暗合拢上来——但你也不再是黑水里那么扎眼的一团亮。',
  });
  return refreshSelection(s);
}

/** 定向 ping 的方向叙述标签（声呐与房间 §5）。 */
const SONAR_DIR_LABEL: Record<SonarDir, string> = { deeper: '更深处', lateral: '侧旁', back: '来路' };

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
 * 一次声呐扫描的核心（声呐与房间 §5/§8.7）：从当前位置揭示有限程内真实节点为草图（stamp 当前 turn）+ 快照猎手位置。
 * 纯揭示，**不动 power / alert / sensors**（由调用方决定暴露与开关态）。手动 ping 与 scan-on-open 共用。
 */
function scanReveal(run: RunState, dir?: SonarDir): { scanMemory: Record<string, number>; stalker: Stalker | undefined } {
  const scanMemory: Record<string, number> = { ...(run.scanMemory ?? {}) };
  if (run.map && run.currentNodeId) {
    for (const id of revealSonarScanDirectional(
      run.map,
      run.currentNodeId,
      sonarScanRange(run),
      dir,
      sonarDirReach(run, dir), // 各方向 reach 各自升级（§5）：聚焦那一向的专精焦距（全向/缺省 → 0 逐字节不变）
    )) {
      scanMemory[id] = run.turn;
    }
  }
  // 猎手 SPEC §2.1/§8.7：扫到猎手（量程内 + 未躲过）→ 刷新它在声呐图上的（会过时的）位置；没扫到/躲过 → 原样。
  const stalker = run.stalker ? scanStalker(run, run.stalker) : undefined;
  return { scanMemory, stalker };
}

/**
 * 主动发一记声呐 ping（深水区 Phase 0a + 声呐渲染重做 §4「本回合反悔」）：耗一大口电 + 当场抬警觉尖峰（loud 主动暴露），
 * 揭示新图。需已解锁 + 有电 + 这一站还没扫过。声呐关时也可用＝「本回合反悔扫一记」（扫了就算本回合开·付暴露·之后再设关只影响下回合）。
 * 定向（dir）聚焦扇区（§5）；全向（缺省）等程。
 */
export function pingSonar(state: GameState, dir?: SonarDir): GameState {
  const run = state.run;
  if (!run) return state;
  if (!(run.sensors?.sonarUnlocked ?? false)) {
    return appendLog(state, { tone: 'system', text: '你还没有能用的声呐。' });
  }
  // 1 scan / 停留（声呐与房间 SPEC §8「1 scan/turn」）：这一站已扫过（自动 scan-on-open 或手动）→ 不重复耗电/暴露。
  if ((run.sensors?.sonar ?? 'off') === 'ping') {
    return appendLog(state, { tone: 'system', text: '脉冲还在水里荡，等它散了再扫一记。' });
  }
  const pingCost = sonarPingCost(run); // 升级派生（缺省 SONAR_PING_COST）
  if ((run.power ?? 0) < pingCost) {
    return appendLog(state, { tone: 'realistic', text: '电量不够再发一记声呐了。' });
  }
  const power = Math.max(0, (run.power ?? 0) - pingCost);
  const { scanMemory, stalker } = scanReveal(run, dir);
  // ping 当场抬警觉尖峰（暴露双刃，SPEC §5）：浅水免压、深 band 更狠；定向时按方向计（更安静 / 正对声感猎手则尖峰）。
  const alert = Math.min(ALERT_MAX, (run.alert ?? 0) + sonarPingAlertDelta(run, dir));
  let s: GameState = {
    ...state,
    run: {
      ...run,
      power,
      alert,
      scanMemory,
      stalker,
      // 手动扫＝本回合发射（sonar='ping'）＝就算之前设了关也算本回合开（付暴露·§4 反悔）。
      sensors: { ...run.sensors, sonar: 'ping', sonarDir: dir },
    },
  };
  s = appendLog(s, {
    tone: 'uncanny',
    text: dir
      ? `你把脉冲收窄，朝${SONAR_DIR_LABEL[dir]}打去——那个方向的回波探得更远，别处却暗了下来。`
      : '你发出一记脉冲。回波荡了回来——只是你说不准能不能信它。',
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
  if ((run.sensors?.sonar ?? 'off') !== 'ping') return state; // standing 关 / 未解锁 → 不自动扫（看旧图）
  const cost = sonarPingCost(run);
  if ((run.power ?? 0) < cost) {
    // 电不够维持声呐 → 这一站哑火（落 off·旧图保留·暴露也随之停）。
    return { ...state, run: { ...run, sensors: { ...run.sensors, sonar: 'off' } } };
  }
  const power = Math.max(0, (run.power ?? 0) - cost);
  const { scanMemory, stalker } = scanReveal(run); // 自动扫＝全向
  return { ...state, run: { ...run, power, scanMemory, stalker } };
}

/**
 * 切换声呐**下回合**开/关（声呐渲染重做 SPEC §4·玩家的控制点＝预承诺下一回合是否关）。
 * 只改 sonarNext，本回合开/关不变（已是上回合定的）；移动时 applyTransit 把 sonarNext 落成下回合的 sonarOn。
 * 本回合若想立刻看＝主动 pingSonar 反悔（付暴露）。未解锁 → 原样。
 */
export function setSonarNext(state: GameState, on: boolean): GameState {
  const run = state.run;
  if (!run || !(run.sensors?.sonarUnlocked ?? false)) return state;
  if (sonarStandingNext(run) === on) return state;
  let s: GameState = { ...state, run: { ...run, sensors: { ...run.sensors, sonarNext: on } } };
  s = appendLog(s, {
    tone: 'system',
    text: on
      ? '你决定下一段路把声呐开着——看得见，但也被听得见。'
      : '你决定下一段路关掉声呐——往黑里走，凭记忆里的旧图摸路。',
  });
  return s;
}
