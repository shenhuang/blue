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

import type { DiveMap, RunState } from '@/types';

// ============================================================
// 可调参数（tunables，SPEC §9）
// ============================================================

/**
 * 一记 ping 揭示的图跳数（无向 BFS 半径）。起步小＝只照身边一小圈（SPEC §5「早期几乎看不出眼前几步之外」）。
 * **范围是声呐最主要的升级轴**（SPEC §8.1/§8.6）——升级轨（接 #62 reach 那套桥）留后续；S0 先给基线常量，
 * 双上限天然成立：BFS 跳数固定 < 大洞全貌；最深的陡降若在跳数之外则照不到（< 最深）。
 */
export const SONAR_SCAN_RANGE = 2;

/** 余像完全淡出所需的回合数（age ≥ 此值 → 主图不再画该节点；残图小地图仍留极淡残迹）。 */
export const SCAN_FADE_TURNS = 6;

/** 本次下潜的有效声呐扫描跳数（S0：基线常量；升级派生留后续，签名先就位便于将来接桥）。 */
export function sonarScanRange(_run: RunState): number {
  return SONAR_SCAN_RANGE;
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
