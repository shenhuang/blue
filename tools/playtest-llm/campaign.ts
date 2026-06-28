// ─────────────────────────────────────────────────────────────────────────────
// tools/playtest-llm/campaign.ts
//
// Full-campaign extension for the LLM-driven playtest harness.
//
// DESIGN — port-boundary checkpointing:
//   Campaign token carries:
//     - portSnapshot: serializeGameState at last port boundary
//     - sinceActions: actions applied since that snapshot (one dive OR one port session)
//     - campaignActions: full ordered log of all actions ever applied
//
//   step rebuilds state from portSnapshot + sinceActions.
//   apply appends an action; when it lands at a fresh port boundary, takes a NEW
//   snapshot and clears sinceActions.  This bounds replay to one dive or one
//   port session, not the whole campaign.
//
//   Per-dive seeds: diveSeed = (campaignSeed + diveIndex * 999983) % 1e9+7.
//   Math.random is re-patched at replay start, same as harness.ts.
//
// Campaign token shape:
//   {
//     campaignSeed: number,
//     startZoneId: string,
//     o2Max: number,
//     diveCount: number,          // how many dives started
//     portSnapshot: string,       // serializeGameState at last port boundary
//     sinceActions: string[],     // actions since that snapshot
//     campaignActions: string[],  // full log
//     maxDives: number,
//     pendingCarry: [{itemId,qty},...],  // consumables staged for next dive
//   }
//
// Meta legal-action ids:
//   PORT phase:
//     sell-item:<itemId>:<qty>           → sellItemToMira
//     buy-item:<itemId>:<qty>            → buyFromMira
//     buy-upgrade:<upgradeId>            → purchaseUpgrade (canPurchase ok)
//     equip:<itemId>                     → equipItem
//     unequip:<slot>                     → unequipItem
//     upgrade-equipment:<slot>           → upgradeEquipment
//     build-lighthouse:<lhId>:<upId>    → buildAtLighthouse
//     dialog-choice:<nodeId>:<choiceIdx> → selectChoice (NPC dialog)
//     wait-days:<n>                      → advanceDays
//     open-chart                         → toChart
//     stop-campaign                      → campaign terminal (agent retires)
//
//   CHART phase:
//     back-to-port                       → toPort
//     carry:<itemId>:<qty>               → queued into pendingCarry (applied at depart)
//     depart:<poiId>                     → startDiveFromPoi + snapshot
//
//   IN-DIVE phase (same ids as harness.ts):
//     node:<nodeId> / feat:<featureId> / ascend / rest / leave
//     event:<optionIndex>
//     combat:<actionId>[:target:<instanceId>]
//
// Auto-advance (no agent choice needed):
//   PORT:   portEvent with single visible option → auto-advance to port
//   DIVE:   ascent, pre_combat, corpse, nodeSelect with forced single-ascent-only
//
// CLI:
//   npx tsx tools/playtest-llm/campaign.ts step  --token <file> [--seed N] [--zone id] [--o2 N] [--max-dives N]
//   npx tsx tools/playtest-llm/campaign.ts apply --token <file> --action <id>
// ─────────────────────────────────────────────────────────────────────────────

import { createInitialGameState, serializeGameState, deserializeGameState } from '@/engine/state';
import {
  handleReturnToPort,
  sellItemToMira,
  buyFromMira,
  listMiraSellables,
  listMiraBuyables,
  advanceDays,
} from '@/engine/port';
import { purchaseUpgrade, canPurchase, getUpgradeLines } from '@/engine/upgrades';
import {
  equipItem,
  unequipItem,
  upgradeEquipment,
  canEquipItem,
  canUnequipSlot,
  canUpgradeEquipment,
  spareEquipmentForSlot,
  nextUpgradeStep,
} from '@/engine/equipment';
import { buildAtLighthouse, canBuildAt, getLighthouseTracks } from '@/engine/lighthouses';
import { getDialogNode, listNpcs, selectChoice } from '@/engine/dialog';
import { evalCondition, isOptionVisible, resolveOption } from '@/engine/events';
import { generateChart, isPoiDepartable } from '@/engine/chart';
import { startDiveFromPoi, carryWeightLimitFor } from '@/engine/dive-start';
import { toPort, toChart } from '@/engine/transitions';
import { getItemDef } from '@/engine/items';
import { makeLcg } from '@/engine/rng';
import { getEventById } from '@/engine/zones';

import {
  replayActionsFromState,
  buildLegalActions as buildDiveLegalActions,
  buildSummary as buildDiveSummary,
  writeCampaignReport,
} from './harness-internal.js';

import * as fs from 'node:fs';
import * as path from 'node:path';
// ── constants ─────────────────────────────────────────────────────────────────
const DIVE_SEED_STEP = 999983; // large prime

// ── token schema ──────────────────────────────────────────────────────────────
export interface CampaignToken {
  campaignSeed: number;
  startZoneId: string;
  o2Max: number;
  diveCount: number;       // how many dives STARTED (depart count)
  // FIX 2 (--max-dives off-by-one): count of dives that have RESOLVED
  // (reached resolution / death / any terminal).  `--max-dives N` ends the run
  // only after N dives have *completed*, so the agent gets N fully PLAYABLE
  // dives.  Gating on diveCount (started) made the Nth depart trip the terminal
  // check before the dive could be played.  Optional in the schema so older
  // tokens written before this field deserialize cleanly (defaults to 0).
  divesCompleted?: number;
  portSnapshot: string;   // serializeGameState at last port boundary
  sinceActions: string[]; // actions since portSnapshot
  campaignActions: string[];
  maxDives: number;
  pendingCarry: Array<{ itemId: string; qty: number }>;
}

// ── legal action ──────────────────────────────────────────────────────────────
export interface LegalAction {
  id: string;
  label: string;
  detail: string;
}

// ── step result shapes ────────────────────────────────────────────────────────
export interface CampaignContinue {
  done: false;
  campaignPhase: string;
  diveCount: number;
  gold: number;
  day: number;       // Bug C fix: expose current world-day so agents can observe wait-days effect
  inventory: Array<{ itemId: string; qty: number; name?: string }>;
  storyFlags: string[];
  summary: string;
  legalActions: LegalAction[];
}

export interface CampaignDone {
  done: true;
  outcome: string;
  summary: string;
  campaignStats: {
    divesPlayed: number;
    upgradesBought: string[];
    gearEquipped: Record<string, string>;
    storyFlagsReached: string[];
    goldFinal: number;
    deaths: number;
  };
  reportPath: string;
}

export type CampaignStepResult = CampaignContinue | CampaignDone;

// ── seed helpers ──────────────────────────────────────────────────────────────
function diveSeedFor(campaignSeed: number, diveIndex: number): number {
  return (campaignSeed + diveIndex * DIVE_SEED_STEP) % 1_000_000_007;
}

// ── snapshot helpers ──────────────────────────────────────────────────────────
function takeSnapshot(state: any): string {
  return serializeGameState(state);
}

function loadSnapshot(snap: string): any {
  return deserializeGameState(snap);
}

// ── port-session replay ───────────────────────────────────────────────────────
// Replays port/chart/meta actions from the snapshot.
// Stops when:
//   - a genuine agent choice is needed (no more actions)
//   - a dive is entered (startDiveFromPoi was applied)
//   - a terminal is reached (gameOver, stop-campaign, etc.)
interface PortSessionResult {
  state: any;
  terminal: { outcome: string; summary: string } | null;
  inDive: boolean; // true = state is now in a dive phase
  // Bug A fix: the dialog node the player is currently mid-conversation on
  // (i.e. they picked a choice whose `next` navigated to another node, not
  // `end` / startDive / openChart / openShop).  null = back at NPC root list.
  activeDialogNodeId: string | null;
  // Bug D: human-readable summary of the last dialog action applied
  lastDialogSummary: string | null;
}

function replayPortSession(token: CampaignToken, actions: string[]): PortSessionResult {
  const base = loadSnapshot(token.portSnapshot);
  if (!base) {
    return {
      state: createInitialGameState(),
      terminal: { outcome: 'error:bad-snapshot', summary: '快照损坏，无法还原。' },
      inDive: false,
      activeDialogNodeId: null,
      lastDialogSummary: null,
    };
  }

  let state = base;
  let actionIdx = 0;
  // Bug A fix: track the current dialog node the player is mid-conversation on.
  // Starts null (= at NPC root list).  Set when a dialog-choice navigates to a
  // next node; cleared when the dialog ends (next=null) or phase changes.
  let activeDialogNodeId: string | null = null;
  // Bug D: accumulate dialog summaries for the last action applied
  let lastDialogSummary: string | null = null;
  const MAX_META = 500;

  for (let i = 0; i < MAX_META; i++) {
    const ph = state.phase;

    // ── auto-advance: resolution (from prior dive) ──────────────────────────
    if (ph.kind === 'resolution') {
      const { state: next } = handleReturnToPort(state);
      state = next;
      continue;
    }

    // ── auto-advance: portEvent with single forced choice ───────────────────
    if (ph.kind === 'portEvent') {
      const ev = getEventById(ph.eventId);
      if (ev) {
        const visible = ev.options.filter((o: any) => isOptionVisible(state, o));
        if (visible.length === 1) {
          // Single forced option — auto-advance
          const res = resolveOption(state, visible[0], ev);
          state = { ...res.state, phase: { kind: 'port' } };
          continue;
        }
        if (visible.length > 1) {
          // Multi-choice portEvent — if we have an action, apply it
          if (actionIdx < actions.length) {
            const raw = actions[actionIdx++];
            const idx = parseInt(raw.replace('port-event:', ''), 10);
            const opt = visible[isNaN(idx) ? 0 : idx] ?? visible[0];
            const res = resolveOption(state, opt, ev);
            state = { ...res.state, phase: { kind: 'port' } };
            continue;
          }
          // Need agent choice for portEvent multi-option
          break;
        }
      }
      // No event or no options — skip to port
      state = toPort(state);
      continue;
    }

    // ── funeral: auto-advance to port ───────────────────────────────────────
    if (ph.kind === 'funeral') {
      state = toPort(state);
      continue;
    }

    // ── gameOver ────────────────────────────────────────────────────────────
    if (ph.kind === 'gameOver') {
      return {
        state,
        terminal: { outcome: 'gameOver', summary: `游戏结束：${ph.reason ?? '未知'}` },
        inDive: false,
        activeDialogNodeId: null,
        lastDialogSummary: null,
      };
    }

    // ── shop: auto-close back to port ───────────────────────────────────────
    if (ph.kind === 'shop') {
      state = toPort(state);
      continue;
    }

    // ── dive/ascent/combat: in-dive phase ───────────────────────────────────
    if (ph.kind === 'dive' || ph.kind === 'ascent' || ph.kind === 'combat') {
      return { state, terminal: null, inDive: true, activeDialogNodeId: null, lastDialogSummary: null };
    }

    // ── port phase: apply meta actions ──────────────────────────────────────
    if (ph.kind === 'port') {
      if (actionIdx >= actions.length) break;
      const raw = actions[actionIdx++];

      if (raw === 'stop-campaign') {
        return {
          state,
          terminal: { outcome: 'agent-stop', summary: '代理人选择结束战役。' },
          inDive: false,
          activeDialogNodeId: null,
          lastDialogSummary: null,
        };
      }

      if (raw === 'open-chart') { state = toChart(state); continue; }

      if (raw.startsWith('sell-item:')) {
        const parts = raw.slice('sell-item:'.length).split(':');
        const qty = parseInt(parts[parts.length - 1], 10) || 1;
        const itemId = parts.slice(0, -1).join(':');
        state = sellItemToMira(state, itemId, qty);
        continue;
      }

      if (raw.startsWith('buy-item:')) {
        const parts = raw.slice('buy-item:'.length).split(':');
        const qty = parseInt(parts[parts.length - 1], 10) || 1;
        const itemId = parts.slice(0, -1).join(':');
        state = buyFromMira(state, itemId, qty);
        continue;
      }

      if (raw.startsWith('buy-upgrade:')) {
        state = purchaseUpgrade(state, raw.slice('buy-upgrade:'.length));
        continue;
      }

      if (raw.startsWith('equip:')) {
        state = equipItem(state, raw.slice('equip:'.length));
        continue;
      }

      if (raw.startsWith('unequip:')) {
        state = unequipItem(state, raw.slice('unequip:'.length) as any);
        continue;
      }

      if (raw.startsWith('upgrade-equipment:')) {
        state = upgradeEquipment(state, raw.slice('upgrade-equipment:'.length) as any);
        continue;
      }

      if (raw.startsWith('build-lighthouse:')) {
        const rest = raw.slice('build-lighthouse:'.length);
        const colonIdx = rest.indexOf(':');
        const lhId = colonIdx >= 0 ? rest.slice(0, colonIdx) : rest;
        const upId = colonIdx >= 0 ? rest.slice(colonIdx + 1) : '';
        state = buildAtLighthouse(state, lhId, upId);
        continue;
      }

      if (raw.startsWith('dialog-choice:')) {
        // Format: dialog-choice:<nodeId>:<choiceIdx>
        const rest = raw.slice('dialog-choice:'.length);
        const lastColon = rest.lastIndexOf(':');
        const nodeId = rest.slice(0, lastColon);
        const choiceIdx = parseInt(rest.slice(lastColon + 1), 10);
        const node = getDialogNode(nodeId);
        if (node) {
          const visible = (node.choices ?? []).filter((c: any) =>
            !c.visibleIf || evalCondition(state, c.visibleIf)
          );
          const choice = visible[isNaN(choiceIdx) ? 0 : choiceIdx] ?? visible[0];
          if (choice) {
            const { state: next, next: nextNode } = selectChoice(state, node, choice);
            state = next;
            // If a dialog startDive effect triggered a dive, surface as inDive
            if (state.phase.kind === 'dive' || state.phase.kind === 'ascent') {
              return { state, terminal: null, inDive: true, activeDialogNodeId: null, lastDialogSummary: null };
            }
            // Bug A fix: if selectChoice returned a next node and we're still
            // in port, record it as the active dialog node so that the NEXT
            // step surfaces THAT node's choices instead of NPC roots.
            // When next is null (end / phase-change / not-found), reset to roots.
            activeDialogNodeId = nextNode ? nextNode.id : null;
            // Bug D: capture text of the chosen line and the node we landed on
            const chosenLabel = choice.label ?? choice.id ?? `选项${choiceIdx}`;
            if (nextNode) {
              // Arrived at a new node — show the node's text (first 120 chars)
              lastDialogSummary = `[${node.id}→${nextNode.id}] 你：「${chosenLabel}」\n${(nextNode.text ?? '').slice(0, 120)}`;
            } else {
              // Dialog ended
              lastDialogSummary = `[${node.id}] 你：「${chosenLabel}」（对话结束）`;
            }
          }
        }
        continue;
      }

      if (raw.startsWith('wait-days:')) {
        const n = parseInt(raw.slice('wait-days:'.length), 10);
        if (n > 0) state = advanceDays(state, n);
        continue;
      }

      // Unknown action — skip
      continue;
    }

    // ── chart phase ─────────────────────────────────────────────────────────
    if (ph.kind === 'chart') {
      if (actionIdx >= actions.length) break;
      const raw = actions[actionIdx++];

      if (raw === 'back-to-port') { state = toPort(state); continue; }

      if (raw.startsWith('carry:')) {
        // carry is tracked on the token, not in state — no-op here in replay
        // The actual carry application happens at depart time
        continue;
      }

      if (raw.startsWith('depart:')) {
        const poiId = raw.slice('depart:'.length);
        const chart = generateChart({ profile: state.profile });
        const poi = chart.pois.find((p: any) => p.id === poiId);
        if (!poi || !isPoiDepartable(state.profile, poi)) continue; // bad action, skip

        // Apply pending carry items
        const carryPicks = token.pendingCarry ?? [];
        state = startDiveFromPoi(state, poi, carryPicks.length > 0 ? { carryItems: carryPicks } : undefined);
        // Now in dive — return so in-dive replayer takes over
        return { state, terminal: null, inDive: true, activeDialogNodeId: null, lastDialogSummary: null };
      }

      // Unknown chart action
      continue;
    }

    break; // unexpected phase
  }

  return { state, terminal: null, inDive: false, activeDialogNodeId, lastDialogSummary };
}

// ── campaign terminal check ───────────────────────────────────────────────────
const CH1_ENDING_FLAGS = [
  'story.ch1.ending.observation',
  'flag.ch1_complete',
  'story.ch1.complete',
  'ch1_end',
];

function checkCampaignTerminal(
  state: any,
  token: CampaignToken,
  diveTerminal?: { outcome: string; summary: string } | null,
): { outcome: string; summary: string } | null {
  const profile = state.profile;

  for (const f of CH1_ENDING_FLAGS) {
    if (profile.flags?.has(f)) {
      return { outcome: 'ch1-ending', summary: `第一章结局达成：${f}。` };
    }
  }

  // FIX 2: gate on dives COMPLETED (resolved), not started — so --max-dives N
  // yields N fully playable dives.  divesCompleted is bumped at each dive's
  // resolution/terminal in cmdStep.
  if ((token.divesCompleted ?? 0) >= token.maxDives) {
    return { outcome: 'maxDives', summary: `战役达到最大潜水次数 ${token.maxDives}，结束。` };
  }

  if (diveTerminal && ['gameOver', 'loop', 'maxSteps', 'error:bad-snapshot'].includes(diveTerminal.outcome)) {
    return diveTerminal;
  }

  return null;
}

// ── FIX 3 helpers: render cost + block reason for unaffordable options ─────────
// Surfacing unaffordable upgrades/equip-upgrades/lighthouse-builds as VISIBLE
// options (so the agent can plan toward them) while keeping `apply` rejecting
// them.  These format the existing can*() guard output into a `detail` string.

function fmtMaterials(mats: Array<{ itemId: string; qty: number }> | undefined): string {
  if (!mats || mats.length === 0) return '';
  return mats.map((m) => `${m.itemId}×${m.qty}`).join('+');
}

function fmtCost(cost: { materials?: Array<{ itemId: string; qty: number }>; gold?: number } | undefined): string {
  if (!cost) return '？';
  const mat = fmtMaterials(cost.materials);
  const gold = cost.gold ?? 0;
  return [mat, `${gold}金`].filter(Boolean).join(' + ');
}

// Turn a can*() availability object into a human "why blocked" suffix.
function fmtBlock(avail: { ok: boolean; reason?: string; shortfall?: Array<{ itemId: string; qty: number }>; goldShort?: number }): string {
  if (avail.ok) return '可购买';
  switch (avail.reason) {
    case 'notEnoughMaterials':
      return `缺材料：${fmtMaterials(avail.shortfall)}`;
    case 'notEnoughGold':
      return `缺金 ${avail.goldShort ?? '?'}`;
    case 'needsPrev':
      return '需先购买前置等级';
    case 'needsLighthouseLevel':
      return '灯塔等级不足';
    case 'maxed':
      return '已满级';
    case 'alreadyOwned':
    case 'alreadyBuilt':
      return '已拥有';
    case 'empty':
      return '该槽位无装备';
    default:
      return avail.reason ?? '不可用';
  }
}

// ── build legal actions (port + chart phases) ─────────────────────────────────
function buildMetaLegalActions(
  state: any,
  _token: CampaignToken,
  activeDialogNodeId: string | null = null,
): LegalAction[] {
  const ph = state.phase;
  const actions: LegalAction[] = [];

  // portEvent（港口过场/抉择事件）：多选项过场停在这里等 agent 选——把可见选项铺成 port-event:N
  // （replayPortSession 同款 id 解析·见上方 apply 路径）。单选项过场已被 replayPortSession 自动推进、不落到这。
  // 没这个 case 时 portEvent 阶段会掉到末尾 `return []` → agent 见空 legalActions、得再 step 一次刷新（playtest 报告 ⑤）。
  if (ph.kind === 'portEvent') {
    const ev = getEventById(ph.eventId);
    const visible = ev ? ev.options.filter((o: any) => isOptionVisible(state, o)) : [];
    visible.forEach((opt: any, i: number) => {
      actions.push({ id: `port-event:${i}`, label: opt.label ?? `选项${i}`, detail: `[过场] ${ph.eventId}` });
    });
    if (actions.length === 0) actions.push({ id: 'port-event:0', label: '继续', detail: `[过场] ${ph.eventId}` });
    return actions;
  }

  if (ph.kind === 'port') {
    // Bug A fix: when the player is mid-conversation on a specific dialog node
    // (i.e. the last dialog-choice navigated to a next node rather than ending
    // the conversation), surface THAT node's choices instead of NPC roots.
    // The node id is surfaced in the action id so the replay parser can find it.
    if (activeDialogNodeId) {
      const node = getDialogNode(activeDialogNodeId);
      if (node) {
        const visible = (node.choices ?? []).filter((c: any) =>
          !c.visibleIf || evalCondition(state, c.visibleIf)
        );
        visible.forEach((choice: any, i: number) => {
          actions.push({
            id: `dialog-choice:${node.id}:${i}`,
            label: choice.label ?? choice.next ?? `选项${i}`,
            detail: `[对话] ${node.id}`,
          });
        });
        // While mid-conversation only surface dialog choices — nothing else.
        return actions;
      }
      // Node not found — fall through to normal port actions
    }

    // sell-item
    for (const s of listMiraSellables(state.profile.inventory)) {
      actions.push({
        id: `sell-item:${s.item.itemId}:${s.item.qty}`,
        label: `卖 ${s.item.itemId} ×${s.item.qty}`,
        detail: `单价 ${s.unitPrice}·合计 ${s.total} 金`,
      });
    }

    // buy-item (limit to affordable, stock > 0)
    for (const b of listMiraBuyables(state.profile)) {
      if (b.stock <= 0) continue;
      if (b.unitPrice > state.profile.bankedGold) continue;
      const max = Math.min(b.stock, Math.floor(state.profile.bankedGold / b.unitPrice));
      if (max <= 0) continue;
      actions.push({
        id: `buy-item:${b.itemId}:1`,
        label: `买 ${b.itemId}`,
        detail: `单价 ${b.unitPrice}·库存 ${b.stock}·最多买 ${max}`,
      });
    }

    // buy-upgrade — FIX 3: surface ALL not-yet-owned upgrades (even unaffordable
    // ones) so the agent can see what exists + their cost + why blocked.  `apply`
    // still re-checks canPurchase and rejects an unaffordable buy (no cheating).
    for (const line of getUpgradeLines()) {
      for (const def of line.upgrades) {
        const avail = canPurchase(state.profile, def.id);
        // Skip ones already owned — those aren't planning targets, just clutter.
        if (!avail.ok && (avail.reason === 'alreadyOwned')) continue;
        const tag = avail.ok ? '' : '[未满足] ';
        actions.push({
          id: `buy-upgrade:${def.id}`,
          label: `${tag}升级：${def.name}`,
          detail: `${line.name} Lv.${def.level}·花费 ${fmtCost(def.cost)}·${fmtBlock(avail)}`,
        });
      }
    }

    // equip
    const loadout = state.profile.equipment ?? {};
    const EQUIP_SLOTS = ['tank', 'suit', 'light', 'tool', 'ranged', 'sonar', 'charm', 'charm2', 'charm3'] as const;
    for (const slot of EQUIP_SLOTS) {
      for (const s of spareEquipmentForSlot(state.profile, slot)) {
        if (canEquipItem(state.profile, s.itemId).ok) {
          actions.push({
            id: `equip:${s.itemId}`,
            label: `装备 ${s.itemId} (${slot})`,
            detail: `仓库 ×${s.qty}`,
          });
        }
      }
    }

    // unequip
    for (const slot of EQUIP_SLOTS) {
      if (canUnequipSlot(state.profile, slot)) {
        const inst = loadout[slot];
        if (inst) {
          actions.push({
            id: `unequip:${slot}`,
            label: `卸下 ${inst.itemId} (${slot})`,
            detail: '退回仓库',
          });
        }
      }
    }

    // upgrade-equipment — FIX 3: surface equipped-gear upgrades even when
    // unaffordable, with cost + why-blocked.  Skip empty/maxed slots (no target).
    // `apply` re-checks canUpgradeEquipment and rejects an unaffordable upgrade.
    for (const slot of EQUIP_SLOTS) {
      const inst = loadout[slot];
      if (!inst) continue;
      const avail = canUpgradeEquipment(loadout, state.profile.inventory, state.profile.bankedGold, slot);
      if (!avail.ok && (avail.reason === 'empty' || avail.reason === 'maxed')) continue;
      const step = nextUpgradeStep(inst);
      const tag = avail.ok ? '' : '[未满足] ';
      const costStr = step ? fmtCost({ materials: step.materials, gold: step.gold }) : '？';
      actions.push({
        id: `upgrade-equipment:${slot}`,
        label: `${tag}改装 ${inst.itemId} Lv.${inst.level}→${inst.level + 1}`,
        detail: `${slot}·花费 ${costStr}·${fmtBlock(avail)}`,
      });
    }

    // build-lighthouse — FIX 3: surface lighthouse facilities even when
    // unaffordable, with cost + why-blocked.  Skip already-built ones.  `apply`
    // re-checks canBuildAt and rejects an unaffordable build.
    for (const lh of state.profile.lighthouses ?? []) {
      for (const track of getLighthouseTracks()) {
        for (const def of track.upgrades) {
          const avail = canBuildAt(state.profile, lh, def.id);
          if (!avail.ok && avail.reason === 'alreadyBuilt') continue;
          const tag = avail.ok ? '' : '[未满足] ';
          actions.push({
            id: `build-lighthouse:${lh.id}:${def.id}`,
            label: `${tag}建造 ${def.name} @ ${lh.name}`,
            detail: `设施 Lv.${def.level}·花费 ${fmtCost(def.cost)}·${fmtBlock(avail)}`,
          });
        }
      }
    }

    // dialog-choice (NPC root nodes — only when not mid-conversation)
    for (const npc of listNpcs()) {
      const root = npc.dialogRoot;
      const visible = (root.choices ?? []).filter((c: any) =>
        !c.visibleIf || evalCondition(state, c.visibleIf)
      );
      visible.forEach((choice: any, i: number) => {
        actions.push({
          id: `dialog-choice:${root.id}:${i}`,
          label: `[${npc.name}] ${choice.label ?? choice.next ?? `选项${i}`}`,
          detail: npc.id,
        });
      });
    }

    // wait-days
    for (const n of [1, 3, 7]) {
      actions.push({
        id: `wait-days:${n}`,
        label: `等待 ${n} 天`,
        detail: `当前第 ${state.profile.day ?? 0} 天`,
      });
    }

    actions.push({ id: 'open-chart', label: '查看海图', detail: '前往 POI 选择' });
    actions.push({ id: 'stop-campaign', label: '结束战役', detail: '代理人主动退出' });
    return actions;
  }

  if (ph.kind === 'chart') {
    actions.push({ id: 'back-to-port', label: '返回港口', detail: '' });

    // carry consumables
    for (const item of state.profile.inventory ?? []) {
      const def = getItemDef(item.itemId);
      if (def?.category === 'consumable' && item.qty > 0) {
        actions.push({
          id: `carry:${item.itemId}:1`,
          label: `携带 ${item.itemId} ×1`,
          detail: `仓库 ×${item.qty}·承载 ${carryWeightLimitFor(state.profile)}kg`,
        });
      }
    }

    // depart
    const chart = generateChart({ profile: state.profile });
    for (const poi of chart.pois) {
      if (isPoiDepartable(state.profile, poi)) {
        actions.push({
          id: `depart:${poi.id}`,
          label: `出海：${poi.name}`,
          detail: `${(poi.blurb ?? '').slice(0, 60)}`,
        });
      }
    }
    return actions;
  }

  return [];
}

// ── build summary ─────────────────────────────────────────────────────────────
function buildCampaignSummary(state: any, token: CampaignToken): string {
  const ph = state.phase;
  const p = state.profile;
  const parts = [
    `潜水 #${token.diveCount}`,
    `金 ${p.bankedGold}`,
    `库存 ${(p.inventory ?? []).length} 种`,
    `升级 ${(p.unlockedUpgrades?.size ?? 0)} 项`,
    ph.kind,
  ];
  return parts.join(' · ');
}

// ── cmdStep ───────────────────────────────────────────────────────────────────
function cmdStep(tokenPath: string, opts: {
  seed?: number; zone?: string; o2?: number; maxDives?: number;
}): void {
  let token: CampaignToken;

  if (fs.existsSync(tokenPath)) {
    token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
  } else {
    // Bootstrap
    const seed = opts.seed ?? (Date.now() % 1_000_000_007);
    (Math as any).random = makeLcg(seed);
    const initialState = createInitialGameState();
    token = {
      campaignSeed: seed,
      // Bug E (DOCUMENT, NOT A BUG): --zone is stored on the token but the
      // prologue dive ignores it.  The aldo.briefing dialog choice hard-codes
      // `{ "kind": "startDive", "zoneId": "zone.east_reef" }` in the engine
      // data (src/data/npcs/aldo.json).  This is intentional — the tutorial
      // always starts at east_reef.  After the prologue, the player picks zones
      // freely via the chart (depart:<poiId>).  Do NOT change this here; any
      // zone-override must be done in the engine data or a separate tutorial flag.
      startZoneId: opts.zone ?? 'zone.east_reef',
      o2Max: opts.o2 ?? 80,
      diveCount: 0,
      divesCompleted: 0,   // FIX 2: dives resolved so far (gates --max-dives)
      portSnapshot: takeSnapshot(initialState),
      sinceActions: [],
      campaignActions: [],
      maxDives: opts.maxDives ?? 20,
      pendingCarry: [],
    };
    fs.mkdirSync(path.dirname(path.resolve(tokenPath)), { recursive: true });
    fs.writeFileSync(tokenPath, JSON.stringify(token, null, 2), 'utf8');
  }

  // Replay port session with current sinceActions
  const portResult = replayPortSession(token, token.sinceActions);
  let state = portResult.state;

  // Port-level terminal check
  const portTerm = portResult.terminal ?? checkCampaignTerminal(state, token, portResult.terminal);
  if (portTerm) {
    const reportPath = writeCampaignReport(token, state, portTerm.outcome, portTerm.summary);
    emitDone(token, state, portTerm, reportPath);
    return;
  }

  // If in-dive, replay dive actions
  if (portResult.inDive) {
    const diveSeed = diveSeedFor(token.campaignSeed, token.diveCount - 1);
    // sinceActions contains: [port actions...] then dive actions
    // But after depart the snapshot is taken at the dive-start state, so sinceActions
    // only has dive actions since the depart snapshot.
    // Actually: portSnapshot is taken at depart time with the dive-start state,
    // and sinceActions are the dive actions since that.
    const diveCtx = replayActionsFromState(state, token.sinceActions, diveSeed);
    state = diveCtx.state;
    const diveTerm = diveCtx.terminal;

    if (diveTerm) {
      // Dive ended
      let endState = state;

      if (diveTerm.outcome === 'resolution') {
        // Auto-return to port and take new snapshot
        const { state: portState } = handleReturnToPort(endState);
        endState = portState;
        // Take new port snapshot.  FIX 2: this dive RESOLVED → bump
        // divesCompleted so the --max-dives gate counts playable dives.
        const updatedToken: CampaignToken = {
          ...token,
          divesCompleted: (token.divesCompleted ?? 0) + 1,
          portSnapshot: takeSnapshot(endState),
          sinceActions: [],
          pendingCarry: [],
        };
        fs.writeFileSync(tokenPath, JSON.stringify(updatedToken, null, 2), 'utf8');
        // Check campaign terminal (uses the bumped divesCompleted).
        const campTerm = checkCampaignTerminal(endState, updatedToken);
        if (campTerm) {
          const reportPath = writeCampaignReport(updatedToken, endState, campTerm.outcome, campTerm.summary);
          emitDone(updatedToken, endState, campTerm, reportPath);
          return;
        }
        // Campaign continues — surface port
        emitContinue(endState, updatedToken, `潜水 #${token.diveCount} 结束（成功），已回港。`);
        return;
      }

      // Non-resolution terminal (death, combat-loss, funeral, etc.).
      // FIX 2: a death/loss still consumes a dive — bump divesCompleted before
      // the terminal check so --max-dives counts it as a played dive.
      const completedToken: CampaignToken = {
        ...token,
        divesCompleted: (token.divesCompleted ?? 0) + 1,
      };
      const campTerm = checkCampaignTerminal(endState, completedToken, diveTerm);
      if (campTerm) {
        const reportPath = writeCampaignReport(completedToken, endState, campTerm.outcome, campTerm.summary);
        emitDone(completedToken, endState, campTerm, reportPath);
        return;
      }

      // funeral / combat-loss → replay will auto-advance to port on next portEvent
      // Take new snapshot at current state
      const updatedToken: CampaignToken = {
        ...completedToken,
        portSnapshot: takeSnapshot(endState),
        sinceActions: [],
        pendingCarry: [],
      };
      fs.writeFileSync(tokenPath, JSON.stringify(updatedToken, null, 2), 'utf8');
      emitContinue(endState, updatedToken, `潜水 #${token.diveCount} 结束（${diveTerm.outcome}）。`);
      return;
    }

    // Dive still ongoing — surface in-dive legal actions
    const diveLegal = buildDiveLegalActions(state);
    const diveSummary = buildDiveSummary(state, diveCtx);
    const ph = state.phase;
    const run = state.run;

    const result: CampaignContinue = {
      done: false,
      campaignPhase: ph.kind === 'dive' ? `dive.${ph.subPhase?.kind}` : ph.kind,
      diveCount: token.diveCount,
      gold: run?.gold ?? 0,
      day: state.profile?.day ?? 0,
      inventory: (run?.inventory ?? []).map((i: any) => ({
        itemId: i.itemId, qty: i.qty, name: getItemDef(i.itemId)?.name,
      })),
      storyFlags: storyFlagsFrom(state),
      summary: `[潜水 #${token.diveCount}] ${diveSummary}`,
      legalActions: diveLegal,
    };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  // Port or chart phase — surface meta actions.
  // Pass activeDialogNodeId so buildMetaLegalActions shows the right choices
  // and lastDialogSummary to give the agent readable dialog feedback (Bug D).
  const baseSummary = portResult.lastDialogSummary
    ? `${portResult.lastDialogSummary}\n\n${buildCampaignSummary(state, token)}`
    : buildCampaignSummary(state, token);
  emitContinue(state, token, baseSummary, portResult.activeDialogNodeId);
}

// ── cmdApply ──────────────────────────────────────────────────────────────────
function cmdApply(tokenPath: string, actionId: string): void {
  if (!fs.existsSync(tokenPath)) {
    process.stderr.write(`[campaign] token not found: ${tokenPath}\n`);
    process.exit(1);
  }
  const token: CampaignToken = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));

  // Replay to get current state and check legality
  const portResult = replayPortSession(token, token.sinceActions);
  const state = portResult.state;

  if (portResult.terminal) {
    process.stderr.write(`[campaign] already terminal: ${portResult.terminal.outcome}\n`);
    process.exit(1);
  }

  const ph = state.phase;

  // In-dive: validate against dive legal actions
  if (portResult.inDive) {
    const diveSeed = diveSeedFor(token.campaignSeed, token.diveCount - 1);
    const diveCtx = replayActionsFromState(state, token.sinceActions, diveSeed);
    if (diveCtx.terminal) {
      process.stderr.write(`[campaign] dive is terminal, call step first\n`);
      process.exit(1);
    }
    const legal = buildDiveLegalActions(diveCtx.state);
    const legalIds = new Set(legal.map((a) => a.id));
    if (!legalIds.has(actionId)) {
      process.stderr.write(`[campaign] illegal dive action: "${actionId}"\n`);
      process.stderr.write(`legal: ${[...legalIds].slice(0, 20).join(', ')}\n`);
      process.exit(1);
    }
    // Append dive action to sinceActions
    const updated: CampaignToken = {
      ...token,
      sinceActions: [...token.sinceActions, actionId],
      campaignActions: [...token.campaignActions, actionId],
    };
    fs.writeFileSync(tokenPath, JSON.stringify(updated, null, 2), 'utf8');
    cmdStep(tokenPath, {});
    return;
  }

  // Carry action (chart phase, tracked on token)
  if (actionId.startsWith('carry:') && ph.kind === 'chart') {
    const parts = actionId.split(':');
    const qty = parseInt(parts[parts.length - 1], 10) || 1;
    const itemId = parts.slice(1, -1).join(':');
    const carry = [...(token.pendingCarry ?? [])];
    const ex = carry.find((c) => c.itemId === itemId);
    if (ex) ex.qty += qty; else carry.push({ itemId, qty });
    const updated: CampaignToken = {
      ...token,
      pendingCarry: carry,
      campaignActions: [...token.campaignActions, actionId],
    };
    fs.writeFileSync(tokenPath, JSON.stringify(updated, null, 2), 'utf8');
    cmdStep(tokenPath, {});
    return;
  }

  // Depart: special — increment diveCount, take snapshot at dive-start state
  if (actionId.startsWith('depart:') && ph.kind === 'chart') {
    const poiId = actionId.slice('depart:'.length);
    const chart = generateChart({ profile: state.profile });
    const poi = chart.pois.find((p: any) => p.id === poiId);
    if (!poi || !isPoiDepartable(state.profile, poi)) {
      // 干净 JSON 错误（agent 读 stdout·别只往 stderr 吐让它看到半截报错）：roam 潜点 id 含 diveCount·
      // 每潜都变 → 粘上一潜旧 id 会命中这里 → 提示重读海图（playtest 报告 ⑤·坏 id 不再崩解析器）。
      const hint = poiId.includes('roam') ? '（roam 潜点 id 每潜变·先 open-chart 重读当前 id 再 depart）' : '';
      process.stdout.write(
        JSON.stringify({ done: false, error: `POI 不可出海或不存在：${poiId}`, hint, kind: 'bad-action' }, null, 2) + '\n',
      );
      process.stderr.write(`[campaign] POI not departable: ${poiId}\n`);
      process.exit(1);
    }
    const carryPicks = token.pendingCarry ?? [];
    let diveState = startDiveFromPoi(state, poi, carryPicks.length > 0 ? { carryItems: carryPicks } : undefined);
    const newDiveCount = token.diveCount + 1;
    const updated: CampaignToken = {
      ...token,
      diveCount: newDiveCount,
      portSnapshot: takeSnapshot(diveState), // snapshot at dive-start
      sinceActions: [],                       // dive actions start fresh
      campaignActions: [...token.campaignActions, actionId],
      pendingCarry: [],
    };
    fs.writeFileSync(tokenPath, JSON.stringify(updated, null, 2), 'utf8');
    cmdStep(tokenPath, {});
    return;
  }

  // Port meta: validate and append to sinceActions.
  // Bug A fix: pass activeDialogNodeId so that mid-conversation dialog choices
  // are validated against the ACTIVE node's choices, not NPC roots.
  const legal = buildMetaLegalActions(state, token, portResult.activeDialogNodeId);
  const legalIds = new Set(legal.map((a) => a.id));

  // Extended validation: wait-days / stop-campaign / open-chart are always flexible.
  // dialog-choice: no longer flexible — the agent must pick from surfaced ids.
  const isFlexible =
    (actionId.startsWith('wait-days:') && ph.kind === 'port') ||
    actionId === 'stop-campaign' ||
    actionId === 'open-chart';

  if (!legalIds.has(actionId) && !isFlexible) {
    process.stderr.write(`[campaign] illegal action: "${actionId}"\n`);
    process.stderr.write(`legal: ${[...legalIds].slice(0, 30).join(', ')}\n`);
    process.exit(1);
  }

  // FIX 3 (apply-side guard): buy-upgrade / upgrade-equipment / build-lighthouse
  // are now SURFACED even when unaffordable (so the agent can plan), but must
  // still be REJECTED on apply when their can*() guard is not ok.  Re-run the
  // exact guard here and refuse with the block reason — the agent can SEE the
  // option but cannot cheat it.
  if (ph.kind === 'port') {
    if (actionId.startsWith('buy-upgrade:')) {
      const upId = actionId.slice('buy-upgrade:'.length);
      const av = canPurchase(state.profile, upId);
      if (!av.ok) {
        process.stderr.write(`[campaign] cannot purchase upgrade "${upId}": ${fmtBlock(av)}\n`);
        process.exit(1);
      }
    } else if (actionId.startsWith('upgrade-equipment:')) {
      const slot = actionId.slice('upgrade-equipment:'.length) as any;
      const av = canUpgradeEquipment(
        state.profile.equipment ?? {},
        state.profile.inventory,
        state.profile.bankedGold,
        slot,
      );
      if (!av.ok) {
        process.stderr.write(`[campaign] cannot upgrade equipment "${slot}": ${fmtBlock(av)}\n`);
        process.exit(1);
      }
    } else if (actionId.startsWith('build-lighthouse:')) {
      const rest = actionId.slice('build-lighthouse:'.length);
      const colonIdx = rest.indexOf(':');
      const lhId = colonIdx >= 0 ? rest.slice(0, colonIdx) : rest;
      const upId = colonIdx >= 0 ? rest.slice(colonIdx + 1) : '';
      const lh = (state.profile.lighthouses ?? []).find((l: any) => l.id === lhId);
      const av = lh ? canBuildAt(state.profile, lh, upId) : { ok: false, reason: 'unknown' as const };
      if (!av.ok) {
        process.stderr.write(`[campaign] cannot build "${upId}" @ "${lhId}": ${fmtBlock(av)}\n`);
        process.exit(1);
      }
    }
  }

  const pendingSince = [...token.sinceActions, actionId];
  const pendingCampaign = [...token.campaignActions, actionId];

  // Check if this action triggers a dive (e.g. dialog startDive effect).
  // Replay with the candidate sinceActions to see whether we land in a dive.
  const probeToken: CampaignToken = { ...token, sinceActions: pendingSince };
  const probeResult = replayPortSession(probeToken, pendingSince);
  if (probeResult.inDive && !portResult.inDive) {
    // Action just entered a dive: take snapshot at dive-start, increment diveCount
    const newDiveCount = token.diveCount + 1;
    const updated: CampaignToken = {
      ...token,
      diveCount: newDiveCount,
      portSnapshot: takeSnapshot(probeResult.state), // snapshot at dive-start state
      sinceActions: [],                               // dive actions start fresh
      campaignActions: pendingCampaign,
      pendingCarry: [],
    };
    fs.writeFileSync(tokenPath, JSON.stringify(updated, null, 2), 'utf8');
    cmdStep(tokenPath, {});
    return;
  }

  const updated: CampaignToken = {
    ...token,
    sinceActions: pendingSince,
    campaignActions: pendingCampaign,
  };
  fs.writeFileSync(tokenPath, JSON.stringify(updated, null, 2), 'utf8');
  cmdStep(tokenPath, {});
}

// ── output helpers ────────────────────────────────────────────────────────────
function storyFlagsFrom(state: any): string[] {
  return [...(state.profile.flags ?? [])]
    .filter((f: string) => f.startsWith('story.') || f.startsWith('flag.') || f.startsWith('ch1_'));
}

function emitContinue(
  state: any,
  token: CampaignToken,
  summary: string,
  activeDialogNodeId: string | null = null,
): void {
  const ph = state.phase;
  const result: CampaignContinue = {
    done: false,
    campaignPhase: ph.kind,
    diveCount: token.diveCount,
    gold: state.profile.bankedGold,
    day: state.profile.day ?? 0,   // Bug C fix: expose day so agents can observe wait-days
    inventory: (state.profile.inventory ?? []).map((i: any) => ({
      itemId: i.itemId, qty: i.qty, name: getItemDef(i.itemId)?.name,
    })),
    storyFlags: storyFlagsFrom(state),
    summary,
    legalActions: buildMetaLegalActions(state, token, activeDialogNodeId),
  };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

function emitDone(token: CampaignToken, state: any, term: { outcome: string; summary: string }, reportPath: string): void {
  const p = state.profile;
  const loadout = p.equipment ?? {};
  const result: CampaignDone = {
    done: true,
    outcome: term.outcome,
    summary: term.summary,
    campaignStats: {
      divesPlayed: token.diveCount,
      upgradesBought: [...(p.unlockedUpgrades ?? [])],
      gearEquipped: Object.fromEntries(
        Object.entries(loadout)
          .filter(([, v]) => v !== null)
          .map(([slot, inst]: any) => [slot, `${inst.itemId}@Lv${inst.level}`])
      ),
      storyFlagsReached: storyFlagsFrom(state),
      goldFinal: p.bankedGold,
      deaths: (p.deaths ?? []).length,
    },
    reportPath,
  };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

// ── CLI ───────────────────────────────────────────────────────────────────────
function main(): void {
  const args = process.argv.slice(2);
  const sub = args[0];

  function flag(name: string, def = ''): string {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] ? args[i + 1] : def;
  }

  const tokenPath = flag('--token', 'tools/playtest-llm/campaign-token.json');
  const seed = parseInt(flag('--seed'), 10) || undefined;
  const zone = flag('--zone', 'zone.east_reef');
  const o2 = parseInt(flag('--o2', '80'), 10);
  const maxDives = parseInt(flag('--max-dives', '20'), 10);

  if (sub === 'step') {
    cmdStep(tokenPath, { seed, zone, o2, maxDives });
  } else if (sub === 'apply') {
    const action = flag('--action');
    if (!action) {
      process.stderr.write('Usage: campaign.ts apply --token <file> --action <id>\n');
      process.exit(1);
    }
    cmdApply(tokenPath, action);
  } else {
    process.stderr.write(
      'Usage: campaign.ts <step|apply> --token <file> [--seed N] [--zone id] [--o2 N] [--max-dives N] [--action id]\n',
    );
    process.exit(1);
  }
}

try {
  main();
} catch (err) {
  // 兜底：任何未捕获异常 → 干净 JSON（别让 play.sh 吐裸 Node stack·agent 解析器会崩·playtest 报告 ⑤）。
  const msg = err instanceof Error ? `${err.message}` : String(err);
  process.stdout.write(JSON.stringify({ done: false, error: msg, kind: 'engine-error' }, null, 2) + '\n');
  process.exit(1);
}
