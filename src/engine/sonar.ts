// 声呐探索扫描（下潜内）—— 声呐与房间 SPEC §5/§7「S0 扫描读真图」。
//
// 一记 ping 从**你当前所在的节点**全向发出、有限程，揭示真实节点图里附近若干跳的节点为草图。
// 本文件只管「读什么 / 多远 / 余像怎么淡」的**纯逻辑**；不可信表象（spoof/evade/低 san 假回波）住
// engine/clarity.ts::sonarReturn（S2 才把节点钩子填上），渲染住 ui/SonarScanPanel + ui/mapLayout。
//
// S0 守则（SPEC §7/§10）：
//   - 只读真图、不改 DiveNode 模型（欺骗留 S2）。
//   - 起步范围很小、范围是主要升级轴（S0 先给基线常量，升级轨留后续）、双上限：< 最深 + < 全洞。
//   - 余像是**会过时的记忆**：扫到的节点记进 run.scanMemory（stamped 当前 turn），随回合渐隐；重复 ping 不更亮
//     （固定亮度，freshness 上限 1）。要刷新就移动后再 ping（再耗电、再暴露）。
//   - 扫描态全走 run 级、不入存档、不 bump SAVE_VERSION（SPEC §8.8）。

import type { DiveMap, RunState, SonarDir } from '@/types';

// ============================================================
// 可调参数（tunables，SPEC §9）
// ============================================================

/**
 * 一记 ping 揭示的图跳数（无向 BFS 半径）的**基线**。起步小＝只照身边一小圈（SPEC §5「早期几乎看不出眼前几步之外」）。
 * **范围是声呐最主要的升级轴**（SPEC §8.1/§8.6）：升级把它从基线逐级推到 SONAR_SCAN_RANGE_MAX（接 #60 桥，
 * 经 sonarScanRangeBonus → deriveSensorTuning → run.sensorTuning.sonarScanRange）。
 */
export const SONAR_SCAN_RANGE = 2;

/**
 * 声呐扫描跳数的**上限**（升级升满也到此为止）——守 SPEC §8.1「双上限：< 最深 + < 全洞」：
 * BFS 跳数封顶 < 大洞直径（迷路图层多支多，4 跳照不全）；最深的陡降若在 4 跳之外则永远扫不到
 *（< 最深）。即「再升级也扫不穿整洞、也照不到最深处」——最深处仍得自己摸黑下去（守北极星）。
 */
export const SONAR_SCAN_RANGE_MAX = 4;

/** 余像完全淡出所需的回合数（age ≥ 此值 → 主图不再画该节点；残图小地图仍留极淡残迹）。 */
export const SCAN_FADE_TURNS = 6;

// ----- 定向 ping（声呐与房间 SPEC §5·作者 2026-06-06 拍板「方向扇区」） -----
// 把声呐朝一个扇区（朝深处/侧向/朝来路）聚焦：那个扇区探更远、别处更短（近场仍全向一小圈、身边不至全黑）。
// 全向（dir undefined）＝旧 revealSonarScan 路径，逐字节不变。
/** 聚焦扇区比基线多探的跳数（「那方向探更远」）。 */
export const SONAR_DIR_FOCUS_BONUS = 1;
/** 聚焦扫描的硬上限跳数（基线上限 +1）——守北极星：再聚焦也扫不穿整洞、照不到最深处（只是单一窄扇区多探一跳）。 */
export const SONAR_DIR_RANGE_MAX = SONAR_SCAN_RANGE_MAX + 1;
/** 非聚焦方向缩短的跳数（「别处更短」）；近场仍保至少 1 跳（身边不至全黑）。 */
export const SONAR_DIR_OFFAXIS_PENALTY = 1;

/**
 * 本次下潜的有效声呐扫描跳数：读 run.sensorTuning（升级派生·deriveSensorTuning 已夹紧到 [基线, 上限]）；
 * 缺省（旧档 / 脚本构造的部分 run / 未升级）→ 回退基线常量＝S0 行为逐字节不变。
 */
export function sonarScanRange(run: RunState): number {
  return run.sensorTuning?.sonarScanRange ?? SONAR_SCAN_RANGE;
}

// ============================================================
// 真图揭示（S0 只读真相）
// ============================================================

/**
 * 无向邻接表：声呐从你这点全向扩散，故按**无向**邻居算（层状图里也照得到你来时的上游、同层旁支）。
 * 与 ui/mapLayout 的无向去重一致（同一张图的两种视角：邻接给「扫到谁」、布局给「画在哪」）。
 */
export function buildUndirectedAdjacency(map: DiveMap): Record<string, string[]> {
  const adj: Record<string, Set<string>> = {};
  const add = (a: string, b: string) => {
    (adj[a] ??= new Set<string>()).add(b);
  };
  for (const n of Object.values(map.nodes)) {
    for (const to of n.connectsTo) {
      if (!map.nodes[to]) continue;
      add(n.id, to);
      add(to, n.id);
    }
  }
  const out: Record<string, string[]> = {};
  for (const k of Object.keys(adj)) out[k] = [...adj[k]];
  return out;
}

/**
 * 一记 ping 从 originId 揭示的节点 id（含 origin 自己），无向 BFS 到 range 跳为止。
 * S0 读真图（不读 evadesSonar/spoofsSonar——那是 S2 的不可信层）。确定性、纯函数。
 */
export function revealSonarScan(map: DiveMap, originId: string, range: number): string[] {
  if (!map.nodes[originId]) return [];
  const adj = buildUndirectedAdjacency(map);
  const seen = new Set<string>([originId]);
  let frontier: string[] = [originId];
  for (let hop = 0; hop < range; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of adj[id] ?? []) {
        if (!seen.has(nb)) {
          seen.add(nb);
          next.push(nb);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return [...seen];
}

// ============================================================
// 定向 ping（声呐与房间 SPEC §5）
// ============================================================

/**
 * 目标节点相对原点的扇区（按 layer 差分，与布局 x∝layer 一致＝声呐图上 深处在右/来路在左/侧向同列）。
 * 原点自身 / 缺节点 → null（总在近场、不参与扇区过滤）。
 */
export function nodeSector(map: DiveMap, originId: string, targetId: string): SonarDir | null {
  const o = map.nodes[originId];
  const t = map.nodes[targetId];
  if (!o || !t || originId === targetId) return null;
  if (t.layer > o.layer) return 'deeper';
  if (t.layer < o.layer) return 'back';
  return 'lateral';
}

/**
 * 一记**定向** ping 揭示的节点 id（SPEC §5「朝一方向聚焦：那方向探更远、别处更短」）。
 *   - 近场＝全向 max(1, base − OFFAXIS_PENALTY) 跳（身边一小圈仍全向、不至全黑）；
 *   - 聚焦扇区＝波束沿该扇区继续扩到 min(SONAR_DIR_RANGE_MAX, base + FOCUS_BONUS) 跳
 *     （超出近场后**只经过聚焦扇区的节点**扩散＝波束连贯、不会冒出孤立远 blip）。
 * dir 缺省 → 退回全向 revealSonarScan（旧行为逐字节不变）。确定性、纯函数（复用无向邻接）。
 */
export function revealSonarScanDirectional(
  map: DiveMap,
  originId: string,
  baseRange: number,
  dir?: SonarDir,
): string[] {
  if (!dir) return revealSonarScan(map, originId, baseRange);
  if (!map.nodes[originId]) return [];
  const nearRange = Math.max(1, baseRange - SONAR_DIR_OFFAXIS_PENALTY);
  const farRange = Math.min(SONAR_DIR_RANGE_MAX, baseRange + SONAR_DIR_FOCUS_BONUS);
  const adj = buildUndirectedAdjacency(map);
  const seen = new Set<string>([originId]);
  let frontier: string[] = [originId];
  for (let hop = 0; hop < farRange; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of adj[id] ?? []) {
        if (seen.has(nb)) continue;
        // 近场全向；超出近场只让波束沿聚焦扇区的节点继续走（连贯·别处更短）。
        const within = hop + 1 <= nearRange || nodeSector(map, originId, nb) === dir;
        if (!within) continue;
        seen.add(nb);
        next.push(nb);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return [...seen];
}

/**
 * 猎手（真实当前位置）相对你的扇区——定向 ping「暴露按方向计」用。无猎手 / 无图 → null。
 * 用真实位置（≠ 声呐上次看到的会过时位置）：你按过时的图瞄，后果却按它现在真在哪算（「图会过时」的张力）。
 */
export function stalkerSector(run: RunState): SonarDir | null {
  const s = run.stalker;
  if (!s || !run.map || !run.currentNodeId) return null;
  return nodeSector(run.map, run.currentNodeId, s.nodeId);
}

/**
 * 这一记定向 ping 是否正对「听得见声音的猎手」（声/双感）所在扇区（SPEC §5「别朝声感猎手方向 ping」）：
 * 是 → 你把响亮的波束正对它、它听见你 → 暴露尖峰（clarity.sonarPingAlertDelta 据此放大）。纯光感的猎手听不见声呐 → 不算。
 */
export function pingAimsAtSoundStalker(run: RunState, dir: SonarDir): boolean {
  const s = run.stalker;
  if (!s || (s.sensesBy !== 'sound' && s.sensesBy !== 'both')) return false;
  return stalkerSector(run) === dir;
}

/**
 * 声呐上**看到的**（会过时的）猎手位置相对你的扇区——UI 给定向按钮的警示用（基于你已知的、不一定准：它可能已移开）。
 * 从没被声呐扫到（无 seenNodeId）→ null（你只「感觉」到它、没法判断方向）。⚠ 与 stalkerSector（真实位置·算暴露）有意分开。
 */
export function seenStalkerSector(run: RunState): SonarDir | null {
  const s = run.stalker;
  if (!s || s.seenNodeId === undefined || !run.map || !run.currentNodeId) return null;
  return nodeSector(run.map, run.currentNodeId, s.seenNodeId);
}

// ============================================================
// 余像渐隐（会过时的记忆）
// ============================================================

/**
 * 给定「这条记忆有多旧」（当前 turn − 扫到时的 turn），返回 0..1 的亮度。
 * age ≤ 0（刚扫到）→ 1（固定满亮，重复 ping 不超过 1）；age ≥ fade → 0（淡尽）；中间线性。
 */
export function scanFreshness(ageTurns: number, fade: number = SCAN_FADE_TURNS): number {
  if (ageTurns <= 0) return 1;
  if (ageTurns >= fade) return 0;
  return 1 - ageTurns / fade;
}
