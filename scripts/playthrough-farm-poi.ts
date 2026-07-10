// 材料刷点范式回归（P1-2·types/chart.ts ChartPoi.openEventPool·dive-start.ts 轮替分支）——
// 把「刷点能刷 + 轮替不反复同一段 + 普通 reef 也能遇到鲨」焊成 regress 门。
//
// 与 check-farm-pois.mjs 分工：那条纯静态守 openEventPool **数据**不变量（挂 anchor / ≥3 beat /
// 引用可解析 / beat 专属 / 与 openEventId 互斥）；本脚本守**运行时接线**：
//   §1 刷点 POI 形状：anchor·persistent·带 openEventPool·无 openEventId·beat 事件都存在
//   §2 轮替机制：startDiveFromPoi 按 runsCompleted 轮替强制开场（0→1→2→回 0·确定性）
//   §3 普通 reef 鲨入口（P1-2 主修）：reef.reef_shark 在 [reef] 普通池；三条刷点 beat 不漏进普通池（专属）
//
// 跑法：npx tsx scripts/playthrough-farm-poi.ts （regress.mjs 按 playthrough*.ts 自动注册）

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createInitialGameState } from '../src/engine/state';
import { TUTORIAL_COMPLETE_FLAG } from '../src/engine/story';
import { buildEventPool, getZone, getEventById } from '../src/engine/zones';
import { startDiveFromPoi } from '../src/engine/dive';
import type { GameState, PlayerProfile, ChartPoi, DiveEvent } from '../src/types';
import { makeHarness, type PtAssert } from './lib/pt';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const pt = makeHarness('材料刷点范式回归');
const { L } = pt;
const assert: PtAssert = pt.assert;

const FARM_POI_ID = 'poi.anchor.reef_shark_shoals';
const POOL = ['reef.shark_run_circling', 'reef.shark_run_pair', 'reef.shark_run_feeding'];

// —— 数据加载（chart_pois mapId-keyed·flatten ch1 段）——
const chartPoisRaw = JSON.parse(
  readFileSync(resolve(ROOT, 'src/data/chart_pois.json'), 'utf-8'),
) as { ch1: { anchors: ChartPoi[]; roamingTemplates: unknown[] } };
const farmPoi = chartPoisRaw.ch1.anchors.find((a) => a.id === FARM_POI_ID);

function profileWith(runsCompleted: number): PlayerProfile {
  const p = createInitialGameState().profile;
  return { ...p, flags: new Set([TUTORIAL_COMPLETE_FLAG]), runsCompleted };
}

const forcedOpenEvent = (runsCompleted: number): string | undefined => {
  const base = createInitialGameState();
  const state: GameState = { ...base, profile: profileWith(runsCompleted) };
  const dived = startDiveFromPoi(state, farmPoi!);
  if (dived.phase.kind === 'dive' && dived.phase.subPhase.kind === 'event') {
    return dived.phase.subPhase.eventId;
  }
  return undefined;
};

// ═══════════════════════════════════════════════════════════════
// §1 刷点 POI 形状
// ═══════════════════════════════════════════════════════════════
L('§1 刷点 POI 形状（anchor·persistent·openEventPool·无 openEventId·beat 都存在）');
{
  assert(farmPoi, `§1 ${FARM_POI_ID} 应在 chart_pois.json ch1.anchors`);
  assert(farmPoi!.persistent === true, '§1 刷点是 persistent anchor（roaming 会丢 openEventPool 字段）');
  assert(Array.isArray(farmPoi!.openEventPool), '§1 刷点带 openEventPool 数组');
  assert(farmPoi!.openEventPool!.length >= 3, `§1 openEventPool ≥3 beat（实际 ${farmPoi!.openEventPool!.length}）`);
  assert(farmPoi!.openEventId === undefined, '§1 刷点不应同时设 openEventId（单一强制开场源·与 openEventPool 互斥）');
  // 池声明与本测试常量一致（防 beat 改名后本脚本悄悄失准）。
  assert(
    JSON.stringify(farmPoi!.openEventPool) === JSON.stringify(POOL),
    `§1 openEventPool 应为 ${JSON.stringify(POOL)}（实际 ${JSON.stringify(farmPoi!.openEventPool)}）`,
  );
  for (const id of farmPoi!.openEventPool!) {
    const e = getEventById(id);
    assert(e, `§1 beat 事件 ${id} 应在 EVENT_DB`);
  }
  L(`  ${FARM_POI_ID} · anchor · ${farmPoi!.openEventPool!.length} beat · 无 openEventId · beat 都存在 ✓`);
}

// ═══════════════════════════════════════════════════════════════
// §2 轮替机制（startDiveFromPoi 按 runsCompleted 轮替强制开场·确定性·"别反复同一段"）
// ═══════════════════════════════════════════════════════════════
L('§2 轮替机制（runsCompleted 驱动·0→1→2→回 0）');
{
  // 连着来四趟（runsCompleted 每潜递进）：beat 依次轮替，第 4 趟回到池首。
  assert(forcedOpenEvent(0) === POOL[0], `§2 runsCompleted=0 → ${POOL[0]}`);
  assert(forcedOpenEvent(1) === POOL[1], `§2 runsCompleted=1 → ${POOL[1]}`);
  assert(forcedOpenEvent(2) === POOL[2], `§2 runsCompleted=2 → ${POOL[2]}`);
  assert(forcedOpenEvent(3) === POOL[0], `§2 runsCompleted=3 → 回 ${POOL[0]}（轮替回池首）`);
  // 反复来同一刷点不会卡在同一段：连续两趟不同（这正是作者要的「能刷但别反复同一段剧情」）。
  for (let n = 0; n < 6; n++) {
    assert(
      forcedOpenEvent(n) !== forcedOpenEvent(n + 1),
      `§2 连续两潜（runs=${n},${n + 1}）开场 beat 应不同（轮替不卡同一段）`,
    );
  }
  L('  轮替 0→1→2→回 0 · 连续两潜必不同 beat ✓');
}

// ═══════════════════════════════════════════════════════════════
// §3 普通 reef 鲨入口 + beat 专属（P1-2 主修）
// ═══════════════════════════════════════════════════════════════
L('§3 普通 reef 有鲨入口（reef.reef_shark 在 [reef] 池）+ 三 beat 专属（不漏进普通池）');
{
  const z = getZone('zone.old_lighthouse_reef');
  assert(z, '§3 zone.old_lighthouse_reef 应注册');
  // reef tag 在 depth 0–44 有效（zones.json zoneTagsByDepth）；取 depth 35。
  const pool = new Set(
    buildEventPool({
      zone: z!,
      depth: 35,
      profileFlags: new Set([TUTORIAL_COMPLETE_FLAG]),
      triggeredEventIds: [],
    }).map((e: DiveEvent) => e.id),
  );
  assert(pool.has('reef.reef_shark'), '§3 reef.reef_shark 在 reef 普通池（P1-2 修：常规 reef 现在能遇到鲨）');
  for (const id of POOL) {
    assert(!pool.has(id), `§3 刷点 beat ${id} 不应在普通下潜池（专属·只经刷点强制开场触发）`);
  }
  L('  reef.reef_shark 入普通 [reef] 池 · 三刷点 beat 专属不漏 ✓');
}

pt.done();
