// 上浮 mini-loop
// 主 SPEC §4.1–4.2 上浮与减压系统

import type { GameState, RunState, Stats } from '@/types';
import { clampStats, appendLog } from './state';
import { executeDeath, ageAndDecayDeaths, getPreservationBonus } from './death';

export type AscentPlan = {
  /** 减压停留次数（按当前氮气浓度计算） */
  stops: number;
  /** 正常上浮所需总回合数 */
  normalTurns: number;
  /** 强行上浮（跳过减压）所需总回合数 */
  rushedTurns: number;
};

export type AscentMode = 'normal' | 'rushed' | 'emergency';

export type AscentResult = {
  state: GameState;
  bendsType: 0 | 1 | 2 | 3 | 4; // 0 = 无；1/2/3/4 = I/II/III/IV 型
  narrative: string[];
};

/** 计算上浮方案 */
export function planAscent(run: RunState): AscentPlan {
  const stops = computeRequiredStops(run.stats.nitrogen);
  const depthTurns = Math.ceil(run.currentDepth / 5);
  return {
    stops,
    normalTurns: depthTurns + stops, // 每段 1 回合 + 每停留 1 回合
    rushedTurns: Math.ceil(depthTurns / 2),
  };
}

export function computeRequiredStops(nitrogen: number): 0 | 1 | 2 | 3 {
  if (nitrogen < 40) return 0;
  if (nitrogen < 60) return 1;
  if (nitrogen < 80) return 2;
  return 3;
}

/** 减压病分级判定 */
function determineBends(
  nitrogenAtStart: number,
  mode: AscentMode,
  depth: number
): 0 | 1 | 2 | 3 | 4 {
  if (mode === 'emergency') {
    // 应急上浮：高深度直接致命
    if (depth >= 25 && nitrogenAtStart >= 60) return 4;
    if (nitrogenAtStart >= 80) return 4;
    return 3;
  }
  if (mode === 'rushed') {
    if (nitrogenAtStart >= 80) return 4;
    if (nitrogenAtStart >= 60) return 3;
    if (nitrogenAtStart >= 40) return 2;
    return 1;
  }
  // normal：完全合规 → 无；否则按残余氮判
  if (nitrogenAtStart >= 80) return 1;
  return 0;
}

/** 执行上浮 */
export function executeAscent(state: GameState, mode: AscentMode): AscentResult {
  let s = state;
  if (!s.run) return { state: s, bendsType: 0, narrative: [] };

  const run = s.run;
  const plan = planAscent(run);
  const narrative: string[] = [];

  // 计算氧气与时间消耗
  const turns = mode === 'normal' ? plan.normalTurns : mode === 'rushed' ? plan.rushedTurns : 1;
  let oxygen = run.stats.oxygen - turns;

  // 氮气：正常上浮按 5/回合排出，强行/应急仅按 2/回合
  const nitrogenReduce = mode === 'normal' ? turns * 5 : turns * 2;
  const nitrogen = Math.max(0, run.stats.nitrogen - nitrogenReduce);

  // 减压病判定
  const bends = determineBends(run.stats.nitrogen, mode, run.currentDepth);

  if (mode === 'normal' && plan.stops > 0) {
    narrative.push(`你按建议在 ${plan.stops} 个深度停留减压。气泡顺着面镜边缘升起。`);
  } else if (mode === 'rushed') {
    narrative.push('你跳过了减压停留。背后的水变浅，但你的关节在响。');
  } else if (mode === 'emergency') {
    narrative.push('你拉响应急上浮。世界变得很白，然后很黑。');
    oxygen = Math.max(0, oxygen - 5); // 剧烈呼吸额外耗氧
  }

  // 死亡判定（应急上浮 + IV 型 = 死亡）
  if (bends === 4) {
    narrative.push('血液里的氮气炸开。你没能挣扎到岸边。');
    return {
      state: executeDeath(s, '严重减压病（IV 型）'),
      bendsType: 4,
      narrative,
    };
  }

  // 应用属性
  const newStats: Stats = clampStats(
    { ...run.stats, oxygen, nitrogen, sanity: run.stats.sanity },
    { stamina: run.staminaMax, oxygen: run.oxygenMax }
  );

  // 减压病的持久效果：写入 profile.flags 给下一次 run 用
  const flags = new Set(s.profile.flags);
  if (bends === 2) flags.add('debuff.bends_ii');
  if (bends === 3) flags.add('debuff.bends_iii');

  s = {
    ...s,
    profile: { ...s.profile, flags },
    run: {
      ...run,
      stats: newStats,
      currentDepth: 0,
      turn: run.turn + turns,
    },
  };

  if (bends === 1) narrative.push('上岸后你皮肤上有几片瘙痒的红斑——I 型减压病，几天就消。');
  if (bends === 2) narrative.push('膝盖和肩膀像是被人拧过——II 型减压病。下次出海体力会差一些。');
  if (bends === 3) narrative.push('你失去了一段时间的记忆。Aldo 把你从船上拖回来时你已经不认得他了——III 型减压病。');

  for (const line of narrative) {
    s = appendLog(s, { tone: bends >= 2 ? 'uncanny' : 'realistic', text: line });
  }

  // 推进到结算
  const buildingPoints = computeBuildingPoints(run);
  const goldFromLoot = computeLootValue(run);

  // 这次 run 结束：海底所有死者老化一次 + 衰减
  const agedDeaths = ageAndDecayDeaths(
    s.profile.deaths,
    getPreservationBonus(s.profile.unlockedUpgrades),
    s.profile.unlockedUpgrades.has('upgrade.salvage_guild.lv3'),
  );

  s = {
    ...s,
    profile: {
      ...s.profile,
      deaths: agedDeaths,
      buildingPoints: s.profile.buildingPoints + buildingPoints,
      runsCompleted: s.profile.runsCompleted + 1,
    },
    phase: {
      kind: 'resolution',
      outcome: {
        survived: true,
        maxDepthReached: run.currentDepth, // 注意：在这里 run 还是上浮前的 depth
        eventsTriggered: run.visitedNodeIds.length,
        buildingPointsEarned: buildingPoints,
        goldEarned: run.gold + goldFromLoot,
        loot: run.inventory,
        newLoreEntries: [],
        cause: bends > 0 ? `减压病 ${'I'.repeat(bends)} 型` : undefined,
      },
    },
  };

  return { state: s, bendsType: bends, narrative };
}

function computeBuildingPoints(run: RunState): number {
  // 主 SPEC §7.1: 最深深度系数 + 触发事件数 × α + 完成事件链 × β
  const depthCoef = Math.floor(run.currentDepth / 5);
  const nodeCoef = run.visitedNodeIds.length;
  return Math.max(3, depthCoef + nodeCoef);
}

function computeLootValue(_run: RunState): number {
  // TODO：接入 items.json 的 sellPrice，目前由 resolution 直接显示战利品列表
  return 0;
}
