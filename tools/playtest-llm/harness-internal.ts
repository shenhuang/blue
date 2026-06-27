// ─────────────────────────────────────────────────────────────────────────────
// tools/playtest-llm/harness-internal.ts
//
// Shared in-dive replay internals extracted from harness.ts so that
// campaign.ts can reuse them without running harness.ts as a subprocess.
//
// DO NOT import from src/ui.  All imports must be from src/engine or std libs.
// ─────────────────────────────────────────────────────────────────────────────

import { createInitialGameState, createNewRun } from '@/engine/state';
import { getEventById } from '@/engine/zones';
import { resolveOption, isOptionVisible } from '@/engine/events';
import {
  startDive,
  moveToNode,
  enterNodeSelection,
  beginAscentFromDive,
  exploreFeature,
  restAtNode,
} from '@/engine/dive';
import { planAscent, executeAscent, isAscentBlocked } from '@/engine/ascent';
import { startCombat, applyPlayerAction, listAvailableActions } from '@/engine/combat';
import { makeLcg } from '@/engine/rng';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.join(__dirname, 'reports');

// ── loop-detection ────────────────────────────────────────────────────────────
export const MAX_LOOP_REPEAT = 8;
export const MAX_STEPS = 600;

export function makeLoopKey(state: any, lastAction: string): string {
  const ph = state.phase;
  const nodeId = state.run?.currentNodeId ?? '';
  const sub = ph.kind === 'dive' ? ph.subPhase?.kind ?? '' : '';
  // Bug B fix: include combat turn index in the key so that the same player
  // action applied on consecutive combat rounds (e.g. repeated evade/ambush)
  // does NOT falsely trip the loop guard.  Each round advances combat.turn,
  // making the key unique per round.  Non-combat phases keep the old key.
  const combatProgress = ph.kind === 'combat' ? `|t${ph.combat?.turn ?? 0}` : '';
  return `${nodeId}|${ph.kind}|${sub}|${lastAction}${combatProgress}`;
}

// ── asset helpers ─────────────────────────────────────────────────────────────
export function requiredStops(n2: number): number {
  return n2 < 40 ? 0 : n2 < 60 ? 1 : n2 < 80 ? 2 : 3;
}

export function ascentReserve(depth: number, n2: number): number {
  return Math.ceil(depth / 5) + requiredStops(n2);
}

// ── loot gold estimate ────────────────────────────────────────────────────────
let _itemSell: Record<string, number> | null = null;

export function itemSellMap(): Record<string, number> {
  if (_itemSell) return _itemSell;
  try {
    const dataPath = path.join(__dirname, '../../src/data/items.json');
    const raw: any = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    const items: any[] = Array.isArray(raw) ? raw : (raw.items ?? Object.values(raw));
    _itemSell = {};
    for (const it of items) (_itemSell as any)[it.id] = it.sellPrice ?? 0;
  } catch {
    _itemSell = {};
  }
  return _itemSell!;
}

export function miraOffer(id: string): number {
  return Math.floor((itemSellMap()[id] ?? 0) * 0.8);
}

export function lootGold(loot: { itemId: string; qty: number }[] | undefined): number {
  if (!loot) return 0;
  return loot.reduce((s, l) => s + miraOffer(l.itemId) * l.qty, 0);
}

// ── replay context ────────────────────────────────────────────────────────────
export interface ReplayContext {
  state: any;
  stepCount: number;
  combats: number;
  maxDepth: number;
  deathCause: string | null;
  goldEarned: number;
  lootAccum: { itemId: string; qty: number }[];
  terminal: { outcome: string; summary: string } | null;
}

// ── setup dive (from scratch) ─────────────────────────────────────────────────
export function setupDive(zoneId: string, o2Max: number): any {
  let s = createInitialGameState();
  s = { ...s, run: createNewRun({ zoneId, bonuses: { oxygenMaxBonus: o2Max - 60 } as any }) };
  s = startDive(s, zoneId, undefined);
  return s;
}

/**
 * Core in-dive replay: given a state that is ALREADY in a dive (phase.kind = 'dive'|'ascent'|'combat'),
 * apply the given actions and return the resulting ReplayContext.
 *
 * This is the factored-out version of harness.ts::replayActions that takes an
 * already-built state rather than re-constructing from a token.
 */
export function replayActionsFromState(
  initialState: any,
  actionsToApply: string[],
  seed: number,
): ReplayContext {
  (Math as any).random = makeLcg(seed);
  let state = initialState;

  const ctx: ReplayContext = {
    state,
    stepCount: 0,
    combats: 0,
    maxDepth: 0,
    deathCause: null,
    goldEarned: 0,
    lootAccum: [],
    terminal: null,
  };

  const loopCounts: Record<string, number> = {};
  let actionIdx = 0;

  for (let step = 0; step < MAX_STEPS; step++) {
    ctx.stepCount = step;
    state = ctx.state;
    const ph = state.phase;

    if (state.run) {
      ctx.maxDepth = Math.max(ctx.maxDepth, state.run.currentDepth ?? 0);
    }

    // ── terminal phases ──────────────────────────────────────────────────────
    if (ph.kind === 'resolution') {
      const o = ph.outcome;
      ctx.goldEarned = o.goldEarned ?? 0;
      ctx.lootAccum = o.loot ?? [];
      ctx.terminal = {
        outcome: 'resolution',
        summary: `潜水成功归来。最大深度 ${ctx.maxDepth}m，金币 ${ctx.goldEarned}，战斗 ${ctx.combats} 次。`,
      };
      return ctx;
    }
    if (ph.kind === 'funeral') {
      ctx.deathCause = ph.record?.cause ?? '未知';
      ctx.terminal = { outcome: 'funeral', summary: `潜水员死亡：${ctx.deathCause}。` };
      return ctx;
    }
    if (ph.kind === 'gameOver') {
      ctx.deathCause = ph.reason ?? '未知';
      ctx.terminal = { outcome: 'gameOver', summary: `游戏结束：${ctx.deathCause}。` };
      return ctx;
    }

    // ── ascent: always auto-advance ──────────────────────────────────────────
    if (ph.kind === 'ascent') {
      const run = state.run;
      const plan = planAscent(run);
      const blocked = isAscentBlocked(run);
      let mode: 'normal' | 'rushed' | 'emergency' = 'normal';
      if (blocked) mode = 'emergency';
      else if (run.stats.oxygen < plan.normalTurns) mode = 'rushed';
      if (!blocked && run.stats.oxygen < plan.rushedTurns) mode = 'emergency';
      const res = executeAscent(state, mode);
      ctx.state = res.state;
      continue;
    }

    // ── combat ────────────────────────────────────────────────────────────────
    // FIX 1 (per-round stepping): ONE logged `combat:*` action = ONE round
    // (player action + enemy response).  Under the replay-from-seed model the
    // dive action log naturally carries one combat entry per round (the agent
    // applies one per surfaced decision point).  We therefore apply the action
    // ONCE and ALWAYS advance actionIdx — whether the round outcome was
    // 'continue' (fight goes on → next logged entry is the next round) or a
    // terminal ('victory'/'flee'/'defeat'/'emergency_ascend' → engine has left
    // the combat phase, the loop falls through to the new phase).  When the log
    // is exhausted mid-fight (actionIdx >= length) we `break`: the caller then
    // surfaces THIS round's legalActions as a fresh decision point.
    //
    // Determinism: seed is re-patched at replay start; logged actions are
    // applied strictly in order, exactly one per round, so the RNG stream is
    // reproduced bit-for-bit on every replay.  The turn-keyed loop guard
    // (makeLoopKey appends `|t<turn>`) keys each round uniquely because
    // applyPlayerAction increments combat.turn on a 'continue' round.
    if (ph.kind === 'combat') {
      if (actionIdx < actionsToApply.length) {
        const raw = actionsToApply[actionIdx];
        const parts = raw.split(':');
        const actionId = parts.slice(1, parts.indexOf('target') !== -1 ? parts.indexOf('target') : undefined).join(':');
        const targetIdx = parts.indexOf('target');
        const targetInstanceId = targetIdx !== -1 ? parts.slice(targetIdx + 1).join(':') : undefined;

        // Count a fresh combat ENCOUNTER once, on its round 1 (combat.turn===0),
        // so the report's 战斗次数 stays a per-encounter count, not per-round.
        if ((ph.combat?.turn ?? 0) === 0) ctx.combats++;

        // Bug B fix (part 2): if the chosen action is no longer available
        // (e.g. stamina fell below the action's cost mid-combat), auto-fallback
        // to a viable action rather than letting the engine silently no-op and
        // spin until the loop guard fires.  Fallback priority: flee (exits
        // combat safely) → breathe (restores O₂) → any other available action.
        // We only do this when the engine would return a no-op continue — we
        // detect that by checking availability before calling applyPlayerAction.
        const availList = listAvailableActions(state);
        const chosenAvail = availList.find(({ action }) => action.id === actionId);
        let effectiveActionId = actionId;
        let effectiveTargetId = targetInstanceId;
        if (chosenAvail && !chosenAvail.availability.available) {
          // Chosen action unavailable — pick a fallback
          const fallbackOrder = ['action.flee', 'action.breathe'];
          let fallback = availList.find(({ action, availability }) =>
            availability.available && fallbackOrder.includes(action.id)
          );
          if (!fallback) {
            // Any available action (skip single-target actions without a live enemy)
            fallback = availList.find(({ action, availability }) => {
              if (!availability.available) return false;
              if (action.targeting === 'single') {
                const enemies: any[] = ph.combat?.enemies ?? [];
                return enemies.some((e: any) => e.hp > 0);
              }
              return true;
            });
          }
          if (fallback) {
            effectiveActionId = fallback.action.id;
            // Single-target fallback: pick the first live enemy
            if (fallback.action.targeting === 'single') {
              const enemies: any[] = ph.combat?.enemies ?? [];
              const firstLive = enemies.find((e: any) => e.hp > 0);
              effectiveTargetId = firstLive?.instanceId;
            } else {
              effectiveTargetId = undefined;
            }
          }
          // If no fallback available either, fall through with the original
          // action (engine will no-op → loop guard will catch it).
        }

        // Round-1 loop guard (turn-keyed): the same action keyed by combat.turn
        // can only legitimately repeat MAX_LOOP_REPEAT times within a single
        // turn index.  Because a 'continue' round bumps combat.turn, normal
        // multi-round play never trips this; a true no-op spin (engine refuses
        // the action and turn stays put) does.
        const lkey = makeLoopKey(state, raw);
        loopCounts[lkey] = (loopCounts[lkey] ?? 0) + 1;
        if (loopCounts[lkey] > MAX_LOOP_REPEAT) {
          ctx.terminal = { outcome: 'loop', summary: `循环检测：战斗动作 "${raw}" 重复 ${loopCounts[lkey]} 次，中止。` };
          return ctx;
        }

        const res = applyPlayerAction(state, effectiveActionId, effectiveTargetId);
        ctx.state = res.state;
        // ONE action consumed = ONE round resolved — advance unconditionally.
        actionIdx++;
        if (res.outcome === 'defeat') {
          ctx.deathCause = '战斗失败';
          ctx.terminal = { outcome: 'combat-loss', summary: '战斗失败，潜水员阵亡。' };
          return ctx;
        }
        // 'victory'/'flee'/'emergency_ascend' → engine already left combat phase;
        // 'continue' → still in combat, next iteration reads the next logged
        // round (or breaks below to surface a decision point if log exhausted).
        continue;
      }
      // Log exhausted mid-combat: this is a per-round decision point.
      // Break out so the caller surfaces the current round's combat actions
      // (updated enemy HP/stamina) as the next thing the agent must decide.
      break;
    }

    // ── pre_combat: auto-confirm ──────────────────────────────────────────────
    if (ph.kind === 'dive' && ph.subPhase?.kind === 'pre_combat') {
      const encId = ph.subPhase.encounterId;
      ctx.state = startCombat(state, encId);
      continue;
    }

    if (ph.kind !== 'dive') {
      // Unexpected non-dive phase (port, shop, etc.) — stop; caller handles it
      break;
    }

    const sub = ph.subPhase;

    // ── event ─────────────────────────────────────────────────────────────────
    if (sub.kind === 'event') {
      if (actionIdx < actionsToApply.length) {
        const raw = actionsToApply[actionIdx];
        const optIdx = parseInt(raw.replace('event:', ''), 10);
        const ev = getEventById(sub.eventId);
        if (!ev) {
          ctx.state = enterNodeSelection(state);
          actionIdx++;
          continue;
        }
        const visible = ev.options.filter((o: any) => isOptionVisible(state, o));
        const opt = visible[optIdx] ?? visible[0];
        if (!opt) {
          ctx.state = enterNodeSelection(state);
          actionIdx++;
          continue;
        }

        const lkey = makeLoopKey(state, raw);
        loopCounts[lkey] = (loopCounts[lkey] ?? 0) + 1;
        if (loopCounts[lkey] > MAX_LOOP_REPEAT) {
          ctx.terminal = { outcome: 'loop', summary: `循环检测：事件选项 "${raw}" 重复 ${loopCounts[lkey]} 次，中止。` };
          return ctx;
        }

        const res = resolveOption(state, opt);
        ctx.state = res.state;
        actionIdx++;

        switch (res.next.kind) {
          case 'continueEvent':
            ctx.state = { ...res.state, phase: { kind: 'dive', subPhase: { kind: 'event', eventId: res.next.eventId } } };
            break;
          case 'startCombat':
            ctx.state = startCombat(res.state, res.next.combatId);
            ctx.combats++;
            break;
          case 'forceAscend':
            ctx.state = { ...res.state, phase: { kind: 'ascent', targetDepth: 0 } };
            break;
          case 'death':
            ctx.deathCause = '事件致死';
            ctx.terminal = { outcome: 'death', summary: '事件选项导致死亡。' };
            return ctx;
          case 'remainOnEvent':
          default:
            ctx.state = enterNodeSelection(res.state);
        }
        continue;
      }
      break;
    }

    // ── rest ──────────────────────────────────────────────────────────────────
    if (sub.kind === 'rest') {
      if (actionIdx < actionsToApply.length) {
        const raw = actionsToApply[actionIdx++];
        if (raw === 'rest') ctx.state = restAtNode(state);
        else ctx.state = enterNodeSelection(state);
        continue;
      }
      break;
    }

    // ── corpse: auto-skip ─────────────────────────────────────────────────────
    if (sub.kind === 'corpse') {
      ctx.state = enterNodeSelection(state);
      continue;
    }

    // ── nodeSelect ────────────────────────────────────────────────────────────
    if (sub.kind === 'nodeSelect') {
      const choices: any[] = sub.choices ?? [];
      const features: any[] = sub.features ?? [];
      const run = state.run;

      const onlyChoice = choices.length === 1 && features.length === 0;
      if (onlyChoice && choices[0].isAscentPoint && !isAscentBlocked(run)) {
        ctx.state = moveToNode(state, choices[0].nodeId);
        continue;
      }

      if (actionIdx < actionsToApply.length) {
        const raw = actionsToApply[actionIdx];

        const lkey = makeLoopKey(state, raw);
        loopCounts[lkey] = (loopCounts[lkey] ?? 0) + 1;
        if (loopCounts[lkey] > MAX_LOOP_REPEAT) {
          ctx.terminal = { outcome: 'loop', summary: `循环检测：节点选择 "${raw}" 重复 ${loopCounts[lkey]} 次，中止。` };
          return ctx;
        }

        actionIdx++;

        if (raw === 'ascend') { ctx.state = beginAscentFromDive(state); continue; }
        if (raw.startsWith('node:')) { ctx.state = moveToNode(state, raw.slice(5)); continue; }
        if (raw.startsWith('feat:')) {
          const featureId = raw.slice(5);
          const feat = features.find((f: any) => f.featureId === featureId);
          if (feat) ctx.state = exploreFeature(state, featureId);
          else ctx.state = enterNodeSelection(state);
          continue;
        }
        ctx.state = enterNodeSelection(state);
        continue;
      }
      break;
    }

    ctx.state = enterNodeSelection(state);
  }

  if (ctx.stepCount >= MAX_STEPS - 1) {
    ctx.terminal = { outcome: 'maxSteps', summary: `超过最大步数 ${MAX_STEPS}，中止。` };
  }

  return ctx;
}

// ── build legal action list (mirrors harness.ts) ──────────────────────────────
export interface LegalAction {
  id: string;
  label: string;
  detail: string;
}

export function buildLegalActions(state: any): LegalAction[] {
  const ph = state.phase;
  const actions: LegalAction[] = [];

  if (ph.kind === 'combat') {
    const avail = listAvailableActions(state);
    const enemies: any[] = ph.combat?.enemies ?? [];
    for (const { action, availability } of avail) {
      if (!availability.available) continue;
      if (action.targeting === 'single' && enemies.length > 0) {
        for (const en of enemies) {
          if (en.hp <= 0) continue;
          actions.push({
            id: `combat:${action.id}:target:${en.instanceId}`,
            label: `${action.name} → ${en.defId} (${en.hp}hp)`,
            detail: availability.reason ? `[disabled: ${availability.reason}] ` : '' + action.description,
          });
        }
      } else {
        actions.push({
          id: `combat:${action.id}`,
          label: action.name,
          detail: action.description,
        });
      }
    }
    return actions;
  }

  if (ph.kind === 'dive') {
    const sub = ph.subPhase;

    if (sub.kind === 'event') {
      const ev = getEventById(sub.eventId);
      if (!ev) return [{ id: 'event:0', label: '继续', detail: '（无法加载事件·继续）' }];
      const visible = ev.options.filter((o: any) => isOptionVisible(state, o));
      visible.forEach((opt: any, i: number) => {
        actions.push({
          id: `event:${i}`,
          label: opt.label ?? opt.id ?? `选项 ${i}`,
          detail: opt.description ?? '',
        });
      });
      return actions;
    }

    if (sub.kind === 'rest') {
      const run = state.run;
      const reserve = ascentReserve(run.currentDepth, run.stats.nitrogen);
      actions.push({ id: 'rest', label: '休息', detail: `恢复体力（O₂ ${run.stats.oxygen}，上升保留 ${reserve}）` });
      actions.push({ id: 'leave', label: '离开', detail: '放弃休息，返回节点选择' });
      return actions;
    }

    if (sub.kind === 'nodeSelect') {
      const choices: any[] = sub.choices ?? [];
      const features: any[] = sub.features ?? [];
      const run = state.run;
      const reserve = ascentReserve(run.currentDepth, run.stats.nitrogen);

      if (!isAscentBlocked(run)) {
        actions.push({
          id: 'ascend',
          label: '开始上升',
          detail: `从深度 ${run.currentDepth}m 开始上升（O₂ ${run.stats.oxygen}，保留 ${reserve}）`,
        });
      }

      for (const c of choices) {
        const tag = c.isAscentPoint ? '[上升点] ' : c.kind ? `[${c.kind}] ` : '';
        actions.push({
          id: `node:${c.nodeId}`,
          label: `${tag}${c.preview ?? c.nodeId}`,
          detail: `深度 ${c.depth}m${c.visited ? '（已访问）' : ''}`,
        });
      }

      for (const f of features) {
        actions.push({
          id: `feat:${f.featureId}`,
          label: `[探索] ${f.preview ?? f.featureId}`,
          detail: `事件 ${f.eventId}`,
        });
      }

      return actions;
    }
  }

  return [{ id: 'unknown', label: '未知阶段', detail: JSON.stringify(ph).slice(0, 120) }];
}

// ── build summary ─────────────────────────────────────────────────────────────
export function buildSummary(state: any, _ctx: ReplayContext): string {
  const ph = state.phase;
  const run = state.run;
  if (!run) return `阶段：${ph.kind}`;

  const stats = run.stats;
  const parts: string[] = [];
  parts.push(`第 ${run.turn} 回合`);
  parts.push(`深度 ${run.currentDepth}m`);
  parts.push(`O₂ ${stats.oxygen}`);
  parts.push(`精神 ${stats.sanity}`);
  parts.push(`体力 ${stats.stamina}`);
  parts.push(`氮 ${stats.nitrogen}`);

  if (ph.kind === 'combat') {
    const enemies = ph.combat?.enemies ?? [];
    const alive = enemies.filter((e: any) => e.hp > 0);
    // FIX 1: surface per-round combat state so each round is an informed
    // decision point — round number, every live enemy's HP, and the player's
    // own stamina (the HP-equivalent resource that combat damage drains).
    const enemyState = alive
      .map((e: any) => `${e.defId} ${e.hp}hp${e.stance ? `/${e.stance}` : ''}`)
      .join('，');
    parts.push(
      `战斗中（回合 ${ph.combat?.turn ?? 0}·${alive.length} 敌：${enemyState || '—'}·体力 ${stats.stamina}）`,
    );
  } else if (ph.kind === 'dive') {
    const sub = ph.subPhase;
    if (sub.kind === 'event') parts.push(`事件：${sub.eventId}`);
    else if (sub.kind === 'nodeSelect') {
      const c = sub.choices?.length ?? 0;
      const f = sub.features?.length ?? 0;
      parts.push(`选点（${c} 节点${f ? `，${f} 特征` : ''}）`);
    } else if (sub.kind === 'rest') parts.push('可休息节点');
  }

  return parts.join(' · ');
}

// ── write dive report ─────────────────────────────────────────────────────────
export function writeReport(
  token: { seed: number; zoneId: string; o2Max: number; actions: string[] },
  ctx: ReplayContext,
  terminal: { outcome: string; summary: string },
): string {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(REPORTS_DIR, `REPORT-${stamp}.txt`);

  const survived = terminal.outcome === 'resolution';
  const lg = lootGold(ctx.lootAccum);

  const lines = [
    '===================================================================',
    `Blue 深海回响 · LLM 试玩报告 · ${stamp}`,
    '===================================================================',
    '',
    `结果：${terminal.outcome}`,
    `摘要：${terminal.summary}`,
    '',
    '── 运行统计 ──────────────────────────────────────────────────────',
    `  区域：        ${token.zoneId}`,
    `  种子：        ${token.seed}`,
    `  最大深度：    ${ctx.maxDepth}m`,
    `  总回合：      ${ctx.state?.run?.turn ?? '?'}`,
    `  存活：        ${survived ? '是' : '否'}`,
    `  死亡原因：    ${ctx.deathCause ?? '—'}`,
    `  战斗次数：    ${ctx.combats}`,
    `  战利品价值：  ${lg} 金`,
    `  事件金币：    ${ctx.goldEarned} 金`,
    `  动作总数：    ${token.actions.length}`,
    `  步骤总数：    ${ctx.stepCount}`,
    '',
    '── 动作日志 ──────────────────────────────────────────────────────',
    ...token.actions.map((a, i) => `  ${String(i + 1).padStart(3)}. ${a}`),
    '',
    '── FINDINGS（由 player-agent 填写） ──────────────────────────────',
    '',
    '  [此处填写：策略观察、卡点、数值感受、叙事高光等]',
    '',
    '===================================================================',
  ];

  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
  return reportPath;
}

// ── campaign report writer ────────────────────────────────────────────────────
export function writeCampaignReport(
  token: {
    campaignSeed: number;
    startZoneId: string;
    diveCount: number;
    campaignActions: string[];
    pendingCarry?: Array<{ itemId: string; qty: number }>;
  },
  state: any,
  outcome: string,
  summary: string,
): string {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(REPORTS_DIR, `CAMPAIGN-${stamp}.txt`);

  const profile = state.profile;
  const loadout = profile.equipment ?? {};
  const gearLines = Object.entries(loadout)
    .filter(([, v]) => v !== null)
    .map(([slot, inst]: any) => `  ${slot}: ${inst.itemId} Lv.${inst.level}`);

  const storyFlags = [...(profile.flags ?? [])]
    .filter((f: string) => f.startsWith('story.') || f.startsWith('flag.') || f.startsWith('ch1_'));

  const lines = [
    '===================================================================',
    `Blue 深海回响 · LLM 战役报告 · ${stamp}`,
    '===================================================================',
    '',
    `结果：${outcome}`,
    `摘要：${summary}`,
    '',
    '── 战役统计 ──────────────────────────────────────────────────────',
    `  战役种子：    ${token.campaignSeed}`,
    `  起始区域：    ${token.startZoneId}`,
    `  潜水次数：    ${token.diveCount}`,
    `  最终金币：    ${profile.bankedGold}`,
    `  死亡记录：    ${(profile.deaths ?? []).length} 次`,
    `  升级解锁：    ${[...(profile.unlockedUpgrades ?? [])].join(', ') || '无'}`,
    `  故事 flags：  ${storyFlags.join(', ') || '无'}`,
    `  总动作数：    ${token.campaignActions.length}`,
    '',
    '── 装备配置 ──────────────────────────────────────────────────────',
    ...gearLines,
    '',
    '── 库存 ──────────────────────────────────────────────────────────',
    ...(profile.inventory ?? []).map((i: any) => `  ${i.itemId} ×${i.qty}`),
    '',
    '── 动作日志（全战役） ────────────────────────────────────────────',
    ...token.campaignActions.map((a: string, i: number) => `  ${String(i + 1).padStart(4)}. ${a}`),
    '',
    '── FINDINGS（由 player-agent 填写） ──────────────────────────────',
    '',
    '  [策略观察、卡点、经济感受、叙事高光等]',
    '',
    '===================================================================',
  ];

  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
  return reportPath;
}
