// 过渡与移动（#106 拆分自 dive.ts）：currentMoveCost（洋流）/ applyTransit（tick + 声呐脉冲归 off）/
// moveToNode（按节点 kind 分发·猎手与伏击经 dive-stalker）。
// 声呐重做（车道 4·感知重做 SPEC §2.2）：移动＝新一回合＝声呐脉冲消散归 off（不再跨回合持续/到站自动扫）——
// ping 是一记瞬时动作，扫在你停留的那一站。

import type { GameState, DiveNode, CurrentStrength } from '@/types';
import { tickTurns } from './events';
import { appendLog } from './state';
import { executeDeath } from './death';
import { computeModifiers } from './modifiers';
import { enterNodeSelection } from './dive-select';
import { stalkerStep, weakStalkerStep, maybeApproachEncounter, maybeHallucinationEncounter } from './dive-stalker';
import { startCombat } from './combat';
import {
  resolveHorrorSapienTier,
  horrorSapienChance,
  buildInhabitedCorpseEncounter,
} from './horror-sapien';

/** 编译期穷尽性检查：将来新增 NodeKind 却忘了在 moveToNode 里处理时，这里会直接报类型错误。 */
function assertNever(x: never): never {
  throw new Error('Unhandled NodeKind: ' + JSON.stringify(x));
}

/**
 * 洋流（海图 POI 修正）对每次节点移动的额外消耗：逆流费力（体力）+ 呼吸更重（氧气）。
 * 纯函数，便于回归断言。none / 未设 → 0。
 */
export function currentMoveCost(
  current: CurrentStrength | undefined,
): { stamina: number; oxygen: number } {
  if (current === 'strong') return { stamina: 8, oxygen: 2 };
  if (current === 'mild') return { stamina: 3, oxygen: 1 };
  return { stamina: 0, oxygen: 0 };
}

/**
 * 过渡到目标节点：tick 过渡回合（1 + 深度差/5）+ 洋流额外消耗 + 叙事日志，并切换 depth/node。
 * 纯过渡，不做死亡判定（moveToNode 紧接着查氧气/理智死亡）。
 */
function applyTransit(state: GameState, target: DiveNode): GameState {
  const run = state.run!;
  const transitionTurns = 1 + Math.floor(Math.abs(target.depth - run.currentDepth) / 5);

  // 负伤修正（负伤 SPEC §5 dive-move 消费点）：移动 tick 氧耗 × o2CostMult、洋流消耗 × 对应 mult。
  // 无伤＝恒等元 1，下方全部算式逐字节不变。
  const mods = computeModifiers(run);
  let ticked = tickTurns(run, transitionTurns, { o2CostMult: mods.o2CostMult });
  // 声呐脉冲消散（感知重做 SPEC §2.2「ping 才扫、不 ping 不扫」）：移动＝新一回合＝上一站那记 ping 荡散归 off。
  // 想在新一站看＝到站后再 ping 一记（付电 + 暴露）。旧「持续开/关 + 到站自动扫」双态状态机已删。
  ticked = {
    ...ticked,
    currentDepth: target.depth,
    currentNodeId: target.id,
    visitedNodeIds: [...ticked.visitedNodeIds, target.id],
    sensors: { ...ticked.sensors, sonar: 'off' },
  };

  // 洋流（海图 POI 修正）：每次移动额外耗体力 + 氧气（在死亡判定前应用，使洋流耗氧也能致死）。
  // 负伤修正乘进实际扣减（currentMoveCost 仍是无修正基准·纯函数回归断言不动），向上取整。
  const curCost = currentMoveCost(run.diveModifier?.current);
  const hasCurrentCost = curCost.stamina > 0 || curCost.oxygen > 0;
  if (hasCurrentCost) {
    ticked = {
      ...ticked,
      stats: {
        ...ticked.stats,
        stamina: Math.max(0, ticked.stats.stamina - Math.ceil(curCost.stamina * mods.staminaCostMult)),
        oxygen: Math.max(0, ticked.stats.oxygen - Math.ceil(curCost.oxygen * mods.o2CostMult)),
      },
    };
  }

  let s: GameState = { ...state, run: ticked };
  s = appendLog(s, {
    tone: 'system',
    text: `你向下游了 ${transitionTurns} 回合，到达 ${target.depth}m。`,
  });
  if (hasCurrentCost) {
    s = appendLog(s, {
      tone: 'realistic',
      text:
        run.diveModifier?.current === 'strong'
          ? '逆着急流游，关节和肺都在抗议。'
          : '洋流推着你，多费了点力气。',
    });
  }
  return s;
}

/** 玩家点选了一个节点 → 进入该节点。过渡耗回合，再按节点 kind 决定下一步 */
export function moveToNode(state: GameState, nodeId: string): GameState {
  const run = state.run;
  if (!run || !run.map) return state;
  const target = run.map.nodes[nodeId];
  if (!target) return state;

  // 迷路图：重访已到过的节点时事件不重播（用 append-only 的 visitedNodeIds 判定，首次到达尚不在表里）
  const isRevisit = run.visitedNodeIds.includes(target.id);

  // 过渡（tick + 洋流消耗 + 叙事）
  let s = applyTransit(state, target);
  const ticked = s.run!;

  // 检查氧气/理智死亡（洋流耗氧也算）
  if (ticked.stats.oxygen <= 0) {
    return executeDeath(s, '氧气耗尽，溺亡');
  }
  if (ticked.stats.sanity <= 0) {
    return executeDeath(s, '理智崩溃，疯狂上浮');
  }

  // 高警觉 + 该 zone 有潜伏捕食者 → 遭遇（先于节点 kind 分发；摸黑可避免）。三条路径：
  //   - 深 band（run.huntEnabled·猎手 SPEC Phase 1）→ 有位置的逼近猎手（出现→逼近→接触才伏击·非接触则照常进节点）；
  //   - 浅水弱变体（猎手 Q3·zone.weakHunts 数据 opt-in·浅水线下小概率）→ 同款逼近猎手的弱版（weakStalkerStep
  //     返回 null＝没 opt-in/没现身 → fall through 旧路径＝逐字节不变）；
  //   - 其它（POI 下潜 / 旧路径）→ 旧 alert→伏击瞬时遭遇（逐字节不变·守 playthrough-stealth §4-§6）。
  if (s.run!.huntEnabled) {
    // run.currentNodeId（applyTransit 前）＝你刚离开的节点 → 对穿接触判定（§5）。
    const hunted = stalkerStep(s, target, run.currentNodeId ?? undefined);
    if (hunted.contact) return hunted.state; // 接触→伏击 combat，提前返回
    s = hunted.state; // 现身 / 逼近 / 跟丢：更新 s（含 run.stalker + 叙事），继续进节点
  } else {
    const weak = weakStalkerStep(s, target, run.currentNodeId ?? undefined);
    if (weak) {
      if (weak.contact) return weak.state; // 弱变体追上 → 伏击 combat（复用浅水池＝小且弱）
      s = weak.state; // 现身 / 逼近 / 跟丢（有它在时旧瞬时伏击让位——捕食者已在场）
    } else {
      const approached = maybeApproachEncounter(s, target);
      if (approached) return approached;
    }
  }

  // 低理智幻觉遭遇（感知重做 SPEC §2.3/§7① 形态 a·「改怪物」的怪物半边）：与上面的真伏击**平行**——
  // 真伏击读警觉（你招来的真危险），幻觉读低 san（是你疯了·世界诚实）。放在真遭遇之后：走到这儿说明本步
  // 没触发真伏击（真伏击 contact 会提前 return），此时才轮到低 san 幻觉，避免一步撞两场。高 san（控制组）→
  // maybeHallucinationEncounter 恒返回 null → 照常进节点（无幻觉怪）。san 回上来即消（下潜里 san 恢复→不再触发）。
  {
    const hallucinated = maybeHallucinationEncounter(s, target);
    if (hallucinated) return hallucinated;
  }

  // 根据节点 kind 决定下一步（声呐重做：到站不自动扫——想看新一站就再 ping 一记·感知重做 SPEC §2.2）
  switch (target.kind) {
    case 'event':
      // 多事件「大房间」(S1)：到房间不自动触发——摆出房内未探 feature ＋ 出口，玩家自己选探哪个 / 走哪条。
      // 重访也走这条：enterNodeSelection 据 activeFlags 过滤掉已探的 feature（探完只剩出口＝安静房间）。
      if (target.features && target.features.length > 0) {
        return enterNodeSelection(s);
      }
      // 重访：（单事件房间）事件已结算过，不重播——退化成一段安静水域（仍可休息/继续/回头）。
      if (isRevisit) {
        s = appendLog(s, { tone: 'realistic', text: '你回到这片水域，只剩自己搅起的沉积慢慢落下。' });
        return { ...s, phase: { kind: 'dive', subPhase: { kind: 'rest' } } };
      }
      if (target.eventId) {
        return { ...s, phase: { kind: 'dive', subPhase: { kind: 'event', eventId: target.eventId } } };
      }
      // 没事件 ID 的 event 节点，退化为休息
      return { ...s, phase: { kind: 'dive', subPhase: { kind: 'rest' } } };

    case 'rest':
    case 'ascent_point':
    case 'air_pocket':
    case 'camp':
      // 休息 / 地标节点都复用 rest subPhase；RestView 按 node.kind 分渲染（普通休息 / 上浮 / 换气 / 扎营）
      return { ...s, phase: { kind: 'dive', subPhase: { kind: 'rest' } } };

    case 'corpse': {
      // 重访已被回收的尸体没意义；未回收则判断有无水鬼占据
      if (target.corpseRecordId && !isRevisit) {
        const record = s.profile.deaths.find((d) => d.id === target.corpseRecordId);
        const tier = resolveHorrorSapienTier(target.depth);
        if (record && tier > 0 && Math.random() < horrorSapienChance(tier)) {
          // 被占据：先打一场战斗；胜/逃后 finalizeVictory/finalizeFlee 自动路由回 corpse subPhase
          const encounter = buildInhabitedCorpseEncounter(record, tier as 1 | 2 | 3);
          return startCombat(s, encounter, undefined, { sourceCorpseId: record.id });
        }
        return { ...s, phase: { kind: 'dive', subPhase: { kind: 'corpse', deathRecordId: target.corpseRecordId } } };
      }
      return { ...s, phase: { kind: 'dive', subPhase: { kind: 'rest' } } };
    }

    case 'shop':
    case 'boss':
      return { ...s, phase: { kind: 'dive', subPhase: { kind: 'rest' } } };

    default:
      return assertNever(target.kind);
  }
}
