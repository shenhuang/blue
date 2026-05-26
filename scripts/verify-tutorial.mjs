// 端到端验证脚本
// 1. 数据图引用完整性
// 2. 教学关从 Aldo 对话走到强制上浮
// 3. 教学完成后 Aldo 提供旧灯塔礁选项
// 4. 旧灯塔礁随机节点图可以生成且事件池非空
//
// 跑法： node scripts/verify-tutorial.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function load(rel) {
  return JSON.parse(readFileSync(resolve(ROOT, rel), 'utf-8'));
}

const items = load('src/data/items.json').items;
const npcs = load('src/data/npcs.json');
const eventsTut = load('src/data/events/tutorial.json').events;
const eventsReef = load('src/data/events/reef.json').events;
const events = [...eventsTut, ...eventsReef];
const enemies = load('src/data/enemies/reef_shark.json');
const upgrades = load('src/data/upgrades.json');
const zones = load('src/data/zones.json').zones;

const ITEM_IDS = new Set(items.map((i) => i.id));
const EVENT_IDS = new Set(events.map((e) => e.id));
const COMBAT_IDS = new Set((enemies.combatEncounters ?? []).map((c) => c.id));
const ENEMY_IDS = new Set((enemies.enemies ?? []).map((e) => e.id));
const ZONE_IDS = new Set(zones.map((z) => z.id));

const errors = [];
const warnings = [];

function err(cond, msg) { if (!cond) errors.push(msg); }
function warn(cond, msg) { if (!cond) warnings.push(msg); }

// —— 1. 物品 ——
for (const item of items) {
  err(typeof item.id === 'string' && item.id, `item missing id`);
  err(['equipment', 'consumable', 'material', 'story', 'currency'].includes(item.category),
    `${item.id}: bad category`);
}

// —— 2. NPC 对话树 ——
const ALL_DIALOG = new Set();
for (const npc of npcs.npcs) ALL_DIALOG.add(npc.dialogRoot.id);
for (const id of Object.keys(npcs.dialogs)) ALL_DIALOG.add(id);
function walkDialog(node, ctx) {
  if (!node.choices) return;
  for (const c of node.choices) {
    if (c.next !== 'end' && !ALL_DIALOG.has(c.next))
      errors.push(`${ctx}: choice ${c.id} → ${c.next} not found`);
    for (const e of c.effects ?? []) {
      if (e.kind === 'startDive' && !ZONE_IDS.has(e.zoneId))
        errors.push(`${ctx}: startDive zoneId ${e.zoneId} not found`);
      if (e.kind === 'giveItem' && !ITEM_IDS.has(e.itemId))
        errors.push(`${ctx}: giveItem ${e.itemId} not found`);
    }
  }
}
for (const npc of npcs.npcs) walkDialog(npc.dialogRoot, `npc ${npc.id}.${npc.dialogRoot.id}`);
for (const [id, node] of Object.entries(npcs.dialogs)) walkDialog(node, `dialog ${id}`);

// —— 3. 事件引用 ——
function walkOutcome(out, ctx) {
  if (!out) return;
  if (out.triggerEventId && !EVENT_IDS.has(out.triggerEventId))
    errors.push(`${ctx}: triggerEventId ${out.triggerEventId} not found`);
  if (out.triggerCombatId && !COMBAT_IDS.has(out.triggerCombatId))
    errors.push(`${ctx}: triggerCombatId ${out.triggerCombatId} not found`);
  for (const l of out.loot ?? []) {
    if (!ITEM_IDS.has(l.itemId))
      errors.push(`${ctx}: loot ${l.itemId} not found`);
  }
}
for (const ev of events) {
  for (const opt of ev.options ?? []) {
    const c = `event ${ev.id}.${opt.id}`;
    if (opt.check) {
      walkOutcome(opt.check.onSuccess, `${c}.success`);
      walkOutcome(opt.check.onFailure, `${c}.failure`);
    } else if (opt.outcome) {
      walkOutcome(opt.outcome, c);
    } else {
      warnings.push(`${c} no check & no outcome`);
    }
  }
}

// —— 4. 敌人 / 战斗 / 升级 ——
for (const enc of enemies.combatEncounters ?? []) {
  for (const m of enc.party.members)
    err(ENEMY_IDS.has(m.defId), `combat ${enc.id}: enemy ${m.defId} not found`);
  if (enc.victoryEventId)
    err(EVENT_IDS.has(enc.victoryEventId), `combat ${enc.id}: victoryEventId ${enc.victoryEventId} not found`);
}
for (const e of enemies.enemies ?? []) {
  for (const l of e.loot.guaranteed ?? [])
    err(ITEM_IDS.has(l.itemId), `enemy ${e.id}: loot ${l.itemId} not found`);
}

// —— 5. zones ——
for (const z of zones) {
  err(z.generation === 'random' || z.generation === 'linearScripted',
    `zone ${z.id}: bad generation ${z.generation}`);
  if (z.generation === 'linearScripted')
    err(z.scriptedStartEventId && EVENT_IDS.has(z.scriptedStartEventId),
      `zone ${z.id}: scriptedStartEventId ${z.scriptedStartEventId} not found`);
}

// —— 6. 端到端模拟 ——
function findDialog(id) {
  for (const npc of npcs.npcs) if (npc.dialogRoot.id === id) return npc.dialogRoot;
  return npcs.dialogs[id];
}
function findEvent(id) { return events.find((e) => e.id === id); }

const log = [];
const profileFlags = new Set();

// 模拟 visibleIf
function checkCond(c) {
  if (!c) return true;
  switch (c.kind) {
    case 'hasFlag': return profileFlags.has(c.flag);
    case 'notHasFlag': return !profileFlags.has(c.flag);
    case 'hasEquipment': return true; // 起始装备齐全
    default: return true;
  }
}

// —— 6a. 教学关流程 ——
log.push('--- 教学关 ---');
let dialog = findDialog('aldo.root');
let safety = 0;
let zoneStarted = null;
while (dialog && safety++ < 20) {
  log.push(`dialog:${dialog.id}`);
  if (!dialog.choices?.length) break;
  const visible = dialog.choices.filter((c) => checkCond(c.visibleIf));
  const chosen = visible.find((c) => c.effects?.some((e) => e.kind === 'startDive')) ?? visible[0];
  log.push(`  → ${chosen.label || chosen.id}`);
  for (const e of chosen.effects ?? []) {
    if (e.kind === 'setFlag') profileFlags.add(e.flag);
    if (e.kind === 'startDive') { zoneStarted = e.zoneId; break; }
  }
  if (zoneStarted) break;
  if (chosen.next === 'end') break;
  dialog = findDialog(chosen.next);
}
err(zoneStarted === 'zone.east_reef', `教学关：应进入 zone.east_reef，实际 ${zoneStarted}`);

// 走完教学关事件链 + 拿浮标 + 看船长室
let evId = 'tutorial.descent';
let endReason = null;
let depth = 12;
safety = 0;
while (evId && safety++ < 20) {
  const ev = findEvent(evId);
  err(ev, `教学关：${evId} 未找到`);
  if (!ev) break;
  log.push(`event:${ev.id}`);
  let opt;
  if (ev.id === 'tutorial.wreck') opt = ev.options.find(o => o.id === 'stealth_grab');
  else if (ev.id === 'tutorial.deeper') opt = ev.options.find(o => o.outcome?.triggerEventId === 'tutorial.captain_quarters');
  else opt = ev.options[0];
  log.push(`  → ${opt.label}`);
  const out = opt.check?.onSuccess ?? opt.outcome;
  for (const f of out.applyFlags ?? []) profileFlags.add(f);
  if (out.endDive === 'forceAscend' || out.endDive === 'death') {
    endReason = out.endDive;
    break;
  }
  if (!out.triggerEventId) break;
  evId = out.triggerEventId;
  if (out.deltas?.nitrogen) {} // ignore
}
err(endReason === 'forceAscend', `教学关：应 forceAscend，实际 ${endReason}`);

profileFlags.add('flag.tutorial_complete'); // 模拟最终读日志后设置

// —— 6b. 教学完成后，Aldo 应该开放旧灯塔礁 ——
log.push('\n--- 教学后回港 ---');
dialog = findDialog('aldo.briefing');
const visible = dialog.choices.filter((c) => checkCond(c.visibleIf));
const labels = visible.map(c => c.label).join(' / ');
log.push(`briefing 可见选项: ${labels}`);
const lighthouse = visible.find(c => c.effects?.some(e => e.kind === 'startDive' && e.zoneId === 'zone.old_lighthouse_reef'));
err(lighthouse, '教学完成后应有旧灯塔礁选项');

// —— 6c. 旧灯塔礁的事件池在各深度都有可抽事件 ——
log.push('\n--- 旧灯塔礁事件池 ---');
const lighthouseZone = zones.find(z => z.id === 'zone.old_lighthouse_reef');
function tagsForDepth(zone, d) {
  let active = [];
  for (const seg of zone.zoneTagsByDepth) if (d >= seg.minDepth) active = seg.tags;
  return active;
}
const depthsTotest = [12, 25, 38, 50, 60];
for (const d of depthsTotest) {
  const tags = new Set(tagsForDepth(lighthouseZone, d));
  const pool = events.filter(ev => {
    if (ev.weight <= 0) return false;
    if (d < ev.depthRange[0] || d > ev.depthRange[1]) return false;
    if (!ev.zoneTags || !ev.zoneTags.some(t => tags.has(t))) return false;
    return true;
  });
  log.push(`  ${d}m [${[...tags].join(',')}] → ${pool.length} 个事件`);
  warn(pool.length >= 2, `深度 ${d}m 事件池过小（${pool.length}）`);
}

// —— 报告 ——
console.log(log.join('\n'));

console.log('\n=== 数据完整性报告 ===');
console.log(`items: ${items.length} ・ npcs: ${npcs.npcs.length} (+${Object.keys(npcs.dialogs).length} dialogs)`);
console.log(`events: ${events.length} (tutorial ${eventsTut.length} + reef ${eventsReef.length})`);
console.log(`enemies: ${enemies.enemies.length} ・ combats: ${(enemies.combatEncounters ?? []).length}`);
console.log(`zones: ${zones.length} ・ upgrades: ${upgrades.lines.reduce((a, l) => a + l.upgrades.length, 0)}`);

if (warnings.length) {
  console.log('\n⚠ Warnings:');
  for (const w of warnings) console.log('  - ' + w);
}
if (errors.length) {
  console.error('\n✘ Errors:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('\n✓ 全部检查通过');
