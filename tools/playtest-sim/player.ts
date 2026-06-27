// ───────────────────────────────────────────────────────────────────────────
// "Real player" simulator for 深海回响 / Blue — drives the actual engine.
// A rational-cautious diver: explores for loot, anticipates the O2 cost of the
// trip home, avoids likely-death gambles and combat, ascends before drowning.
// Reused by run-tiers.ts / run-economy.ts. Pure read of the engine; writes nothing.
// ───────────────────────────────────────────────────────────────────────────
import { createInitialGameState, createNewRun } from '@/engine/state';
import { getEventById } from '@/engine/zones';
import { resolveOption, isOptionVisible } from '@/engine/events';
import {
  startDive, moveToNode, enterNodeSelection, beginAscentFromDive,
  exploreFeature, restAtNode,
} from '@/engine/dive';
import { resolveAscent, executeAscent, isAscentBlocked } from '@/engine/ascent';
import { startCombat, applyPlayerAction, listAvailableActions } from '@/engine/combat';
import { makeLcg } from '@/engine/rng';
import itemsData from '@/data/items.json';

// ── item sell-value map (Mira pays floor(sellPrice * 0.8)) ──────────────────
const RAW: any = itemsData as any;
const ITEMS: any[] = Array.isArray(RAW) ? RAW : (RAW.items ?? Object.values(RAW));
const SELL: Record<string, number> = {};
for (const it of ITEMS) SELL[it.id] = it.sellPrice ?? 0;
export function miraOffer(id: string): number { return Math.floor((SELL[id] ?? 0) * 0.8); }
export function lootGold(inv: { itemId: string; qty: number }[] | undefined): number {
  if (!inv) return 0;
  return inv.reduce((s, l) => s + miraOffer(l.itemId) * l.qty, 0);
}

// ── helpers mirroring engine balance ────────────────────────────────────────
function requiredStops(n2: number): number { return n2 < 40 ? 0 : n2 < 60 ? 1 : n2 < 80 ? 2 : 3; }
function ascentReserveO2(depth: number, n2: number): number { return Math.ceil(depth / 5) + requiredStops(n2); }
function checkProb(statVal: number, dc: number): number {
  return Math.max(0.05, Math.min(0.95, 0.5 + (statVal - dc) * 0.015));
}

// ── event option scoring (rational player: weigh loot vs risk, dodge death/combat)
function lootVal(loot: any[] | undefined): number {
  if (!loot) return 0;
  let v = 0;
  for (const r of loot) {
    const q = Array.isArray(r.qty) ? (r.qty[0] + r.qty[1]) / 2 : (r.qty ?? 1);
    v += miraOffer(r.itemId) * q * (r.chance ?? 1);
  }
  return v;
}
function outcomeVal(oc: any): number {
  if (!oc) return 0;
  if (oc.endDive === 'death') return -1e6;
  let v = 0;
  v += lootVal(oc.loot);
  v += oc.goldDelta || 0;
  const d = oc.deltas || {};
  v += (d.oxygen || 0) * 1.0;
  v += (d.sanity || 0) * 0.4;
  v += (d.stamina || 0) * 0.2;
  v -= (oc.oxygenTurnCost || 0) * 1.0;
  if (oc.triggerCombatId) v -= 40;          // cautious players avoid fights
  if (oc.endDive === 'forceAscend') v -= 25; // cuts the dive short
  return v;
}
function outcomeValF(oc: any, fight: boolean): number {
  let v = outcomeVal(oc);
  if (fight && oc && oc.triggerCombatId) v += 80; // fighter seeks combat (re-add the -40 and bonus)
  return v;
}
function optionScore(state: any, opt: any, fight: boolean): number {
  if (opt.check && state.run) {
    const sv = (state.run.stats as any)[opt.check.stat] ?? 0;
    const p = checkProb(sv, opt.check.dc);
    return p * outcomeValF(opt.check.onSuccess, fight) + (1 - p) * outcomeValF(opt.check.onFailure, fight);
  }
  return outcomeValF(opt.outcome, fight);
}

export interface RunResult {
  zoneId: string;
  end: string;                // resolution | funeral | death | gameOver | combat-loss | maxSteps | error
  survived: boolean;
  startDepth: number;
  maxDepth: number;
  turns: number;
  o2AtTurnaround: number | null;   // O2 left the moment ascent began (margin metric)
  depthAtTurnaround: number | null;
  minO2: number;
  minSanity: number;
  lootGold: number;            // Mira value of what was brought up
  goldEarned: number;          // event gold banked
  bends: number | null;        // bends type at ascent (0..4)
  deathCause: string | null;
  combats: number;             // # combats entered
  lootItems: Record<string, number>;
  steps: number;
}

interface PlayOpts { margin: number; maxSteps?: number; fightForLoot?: boolean; }

// debug: every combat entry logged here (cleared by caller)
export const COMBAT_LOG: { combatId: string; enemies: string[]; depth: number }[] = [];

// ── combat: fighter hits weakest until win; avoider flees; both bail if losing ──
function doCombat(state: any, rec: RunResult, fight: boolean): any {
  rec.combats++;
  try {
    COMBAT_LOG.push({
      combatId: state.phase.combat?.combatId ?? '?',
      enemies: (state.phase.combat?.enemies ?? []).map((e: any) => e.defId),
      depth: state.run?.currentDepth ?? -1,
    });
  } catch {}
  let s = state;
  for (let i = 0; i < 80; i++) {
    if (s.phase.kind !== 'combat') break;
    const enemies = s.phase.combat?.enemies ?? [];
    const target = enemies.slice().sort((a: any, b: any) => a.hp - b.hp)[0]?.instanceId;
    const avail = listAvailableActions(s).filter((a: any) => a.availability.available);
    if (avail.length === 0) break;
    const flee = avail.find((a: any) => /flee|retreat|decoy|escape|ascend/i.test(a.action.id));
    const atk = avail.find((a: any) => /strike|stab|attack|fire|shoot|harpoon|knife|hack|chop|slash|jab/i.test(a.action.id));
    // fighter attacks unless stamina low; avoider flees if it can
    const staminaLow = (s.run?.stats.stamina ?? 100) < 18;
    let pick;
    if (fight && !staminaLow) pick = (atk ?? avail[0]).action;
    else pick = (flee ?? atk ?? avail[0]).action;
    const res = applyPlayerAction(s, pick.id, target);
    s = res.state;
    if (res.outcome === 'defeat') { rec.end = 'combat-loss'; rec.deathCause = '战斗失败'; break; }
    if (res.outcome === 'victory' || res.outcome === 'flee' || res.outcome === 'emergency_ascend') break;
  }
  return s;
}

export function playDive(state0: any, opts: PlayOpts): RunResult {
  const maxSteps = opts.maxSteps ?? 600;
  const startDepth = state0.run?.currentDepth ?? 0;
  const rec: RunResult = {
    zoneId: state0.run?.zoneId ?? '?', end: 'maxSteps', survived: false,
    startDepth, maxDepth: startDepth, turns: 0, o2AtTurnaround: null, depthAtTurnaround: null,
    minO2: state0.run?.stats.oxygen ?? 0, minSanity: state0.run?.stats.sanity ?? 100,
    lootGold: 0, goldEarned: 0, bends: null, deathCause: null, combats: 0, lootItems: {}, steps: 0,
  };
  let state = state0;
  const restedNodes = new Set<string>();

  for (let step = 0; step < maxSteps; step++) {
    rec.steps = step;
    const ph = state.phase;
    if (state.run) {
      rec.maxDepth = Math.max(rec.maxDepth, state.run.currentDepth);
      rec.minO2 = Math.min(rec.minO2, state.run.stats.oxygen);
      rec.minSanity = Math.min(rec.minSanity, state.run.stats.sanity);
      rec.turns = state.run.turn;
    }

    if (ph.kind === 'resolution') {
      rec.end = 'resolution'; rec.survived = true;
      const o = ph.outcome;
      rec.maxDepth = Math.max(rec.maxDepth, o.maxDepthReached ?? 0);
      rec.goldEarned = o.goldEarned ?? 0;
      rec.lootGold = lootGold(o.loot);
      for (const l of (o.loot ?? [])) rec.lootItems[l.itemId] = (rec.lootItems[l.itemId] ?? 0) + l.qty;
      return rec;
    }
    if (ph.kind === 'funeral') {
      rec.end = 'funeral'; rec.deathCause = rec.deathCause ?? ph.record?.cause ?? '未知'; return rec;
    }
    if (ph.kind === 'gameOver') { rec.end = 'gameOver'; rec.deathCause = ph.reason ?? '未知'; return rec; }

    if (ph.kind === 'ascent') {
      if (rec.o2AtTurnaround == null && state.run) {
        rec.o2AtTurnaround = state.run.stats.oxygen;
        rec.depthAtTurnaround = state.run.currentDepth;
      }
      const run = state.run;
      // 上浮 mode 收口到引擎单点 resolveAscent（上浮系统 SPEC §2·删本地拷贝）：blocked→失保 emergency·弃战 duress 透传。
      const r = resolveAscent(run, { duress: ph.duress });
      const mode = r.kind === 'blocked' ? 'emergency' : r.mode;
      const res = executeAscent(state, mode);
      state = res.state;
      rec.bends = res.bendsType ?? rec.bends;
      continue;
    }

    if (ph.kind === 'combat') { state = doCombat(state, rec, !!opts.fightForLoot); if (rec.end === 'combat-loss') return rec; continue; }

    if (ph.kind !== 'dive') { rec.end = 'unexpected:' + ph.kind; return rec; }

    const sub = ph.subPhase;
    try {
      if (sub.kind === 'event') {
        const ev = getEventById(sub.eventId);
        if (!ev) { state = enterNodeSelection(state); continue; }
        const visible = ev.options.filter((o: any) => isOptionVisible(state, o));
        if (visible.length === 0) { state = enterNodeSelection(state); continue; }
        let best = visible[0], bestScore = -Infinity;
        // stop seeking new fights once we've had enough this dive (avoid runaway stalker loops)
        const fightNow = !!opts.fightForLoot && rec.combats < 12;
        for (const o of visible) { const sc = optionScore(state, o, fightNow); if (sc > bestScore) { bestScore = sc; best = o; } }
        const res = resolveOption(state, best);
        state = res.state;
        switch (res.next.kind) {
          case 'continueEvent':
            state = { ...state, phase: { kind: 'dive', subPhase: { kind: 'event', eventId: res.next.eventId } } };
            break;
          case 'startCombat':
            state = startCombat(state, res.next.combatId);
            break;
          case 'forceAscend':
            state = { ...state, phase: { kind: 'ascent', targetDepth: 0 } };
            break;
          case 'death':
            rec.end = 'death'; rec.deathCause = '事件致死'; return rec;
          case 'remainOnEvent':
          default:
            state = enterNodeSelection(state);
        }
        continue;
      }

      if (sub.kind === 'nodeSelect') {
        const run = state.run;
        const reserve = ascentReserveO2(run.currentDepth, run.stats.nitrogen);
        const mustGo = run.stats.oxygen <= reserve + opts.margin || run.stats.sanity <= 12 || run.stats.stamina <= 3 || rec.combats >= 14;
        const choices: any[] = sub.choices ?? [];
        const features: any[] = sub.features ?? [];

        if (mustGo) {
          const ap = choices.find((c) => c.isAscentPoint);
          if (ap) { state = moveToNode(state, ap.nodeId); continue; }
          if (!isAscentBlocked(run)) { state = beginAscentFromDive(state); continue; }
          // closed zone, no ascent point in view → head shallowest to find one
          const up = choices.slice().sort((a, b) => a.depth - b.depth)[0];
          if (up) { state = moveToNode(state, up.nodeId); continue; }
          state = beginAscentFromDive(state); continue;
        }

        // explore room features for loot if budget comfortable
        if (features.length > 0 && run.stats.oxygen > reserve + opts.margin + 3) {
          state = exploreFeature(state, features[0].featureId); continue;
        }

        // pick a node to advance, anticipating the O2 cost of going there
        const nonBoss = choices.filter((c) => c.kind !== 'boss');
        const pool = nonBoss.length ? nonBoss : choices;
        const d1 = run.currentDepth, o2 = run.stats.oxygen, n2 = run.stats.nitrogen;
        function affordable(c: any): boolean {
          const tt = 1 + Math.floor(Math.abs(c.depth - d1) / 5);
          const cost = tt * (1 + c.depth / 50) + 2; // +2 current buffer
          const resAfter = ascentReserveO2(c.depth, Math.min(95, n2 + 5));
          return (o2 - cost) >= resAfter + opts.margin;
        }
        const deeperOk = pool.filter((c) => c.depth >= d1 && affordable(c)).sort((a, b) => b.depth - a.depth);
        const anyOk = pool.filter(affordable).sort((a, b) => b.depth - a.depth);
        let pick = deeperOk[0] ?? anyOk[0];
        if (!pick) {
          // can't safely advance anywhere → leave
          const ap = choices.find((c) => c.isAscentPoint);
          if (ap) { state = moveToNode(state, ap.nodeId); continue; }
          if (!isAscentBlocked(run)) { state = beginAscentFromDive(state); continue; }
          pick = pool.slice().sort((a, b) => a.depth - b.depth)[0]; // head up
        }
        if (!pick) { state = beginAscentFromDive(state); continue; }
        state = moveToNode(state, pick.nodeId);
        continue;
      }

      if (sub.kind === 'rest') {
        const run = state.run;
        const reserve = ascentReserveO2(run.currentDepth, run.stats.nitrogen);
        const nid = run.currentNodeId;
        if (run.stats.stamina < 55 && run.stats.oxygen > reserve + opts.margin + 6 && nid && !restedNodes.has(nid)) {
          restedNodes.add(nid);
          state = restAtNode(state);
          continue;
        }
        state = enterNodeSelection(state);
        continue;
      }

      if (sub.kind === 'corpse') { state = enterNodeSelection(state); continue; }

      // unknown subphase
      state = enterNodeSelection(state);
    } catch (e: any) {
      rec.end = 'error:' + (e?.message ?? String(e)).slice(0, 90);
      return rec;
    }
  }
  return rec;
}

// ── set up a single dive into a zone at a chosen depth band & O2 tank ────────
export function setupDive(zoneId: string, depthRange: [number, number] | null, oxygenMax: number): any {
  let s = createInitialGameState();
  s = { ...s, run: createNewRun({ zoneId, bonuses: { oxygenMaxBonus: oxygenMax - 60 } as any }) };
  s = startDive(s, zoneId, depthRange ? { depthRange } : undefined);
  return s;
}

// ── aggregate K seeded runs of one (zone, band, O2, margin) cell ─────────────
export interface Agg {
  label: string; zoneId: string; band: string; o2max: number; margin: number; n: number;
  survival: number; avgMaxDepth: number; avgTurns: number;
  avgO2Turnaround: number; avgDepthTurnaround: number; avgMinSanity: number;
  avgLootGold: number; medLootGold: number; avgGoldEarned: number;
  deaths: Record<string, number>; bends: Record<string, number>; ends: Record<string, number>;
  combats: number; drops: Record<string, number>;
}
export function runCell(
  zoneId: string, band: string, depthRange: [number, number] | null,
  o2max: number, margin: number, n: number, seedBase: number, fight = false,
): Agg {
  const results: RunResult[] = [];
  for (let i = 0; i < n; i++) {
    (Math as any).random = makeLcg(seedBase + i * 7919 + Math.round(o2max) * 13 + margin);
    let r: RunResult;
    try { r = playDive(setupDive(zoneId, depthRange, o2max), { margin, fightForLoot: fight }); }
    catch (e: any) {
      r = { zoneId, end: 'error:' + (e?.message ?? e).slice(0, 80), survived: false, startDepth: 0, maxDepth: 0,
        turns: 0, o2AtTurnaround: null, depthAtTurnaround: null, minO2: 0, minSanity: 0, lootGold: 0,
        goldEarned: 0, bends: null, deathCause: 'harness', combats: 0, lootItems: {}, steps: 0 } as RunResult;
    }
    results.push(r);
  }
  const survived = results.filter((r) => r.survived);
  const loots = survived.map((r) => r.lootGold).sort((a, b) => a - b);
  const med = loots.length ? loots[Math.floor(loots.length / 2)] : 0;
  const deaths: Record<string, number> = {}, bends: Record<string, number> = {}, ends: Record<string, number> = {}, drops: Record<string, number> = {};
  for (const r of results) {
    ends[r.end] = (ends[r.end] ?? 0) + 1;
    if (!r.survived) deaths[r.deathCause ?? '?'] = (deaths[r.deathCause ?? '?'] ?? 0) + 1;
    if (r.bends != null) bends['type' + r.bends] = (bends['type' + r.bends] ?? 0) + 1;
    for (const [k, v] of Object.entries(r.lootItems)) drops[k] = (drops[k] ?? 0) + v;
  }
  const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  const turnarounds = results.filter((r) => r.o2AtTurnaround != null);
  return {
    label: band, zoneId, band, o2max, margin, n,
    survival: results.filter((r) => r.survived).length / n,
    avgMaxDepth: avg(results.map((r) => r.maxDepth)),
    avgTurns: avg(results.map((r) => r.turns)),
    avgO2Turnaround: avg(turnarounds.map((r) => r.o2AtTurnaround as number)),
    avgDepthTurnaround: avg(turnarounds.map((r) => r.depthAtTurnaround as number)),
    avgMinSanity: avg(results.map((r) => r.minSanity)),
    avgLootGold: avg(survived.map((r) => r.lootGold)),
    medLootGold: med,
    avgGoldEarned: avg(survived.map((r) => r.goldEarned)),
    deaths, bends, ends, combats: results.reduce((a, r) => a + r.combats, 0), drops,
  };
}
