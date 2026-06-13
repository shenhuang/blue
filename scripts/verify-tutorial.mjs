// 端到端验证脚本
// 1. 数据图引用完整性
// 2. 教学关从 Aldo 对话走到强制上浮
// 3. 教学完成后 Aldo 提供旧灯塔礁选项
// 4. 旧灯塔礁随机节点图可以生成且事件池非空
//
// 跑法： node scripts/verify-tutorial.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function load(rel) {
  return JSON.parse(readFileSync(resolve(ROOT, rel), 'utf-8'));
}

const items = load('src/data/items.json').items;

// npcs 现在按文件拆分到 src/data/npcs/<npcId>.json
const NPC_DIR = resolve(ROOT, 'src/data/npcs');
const npcFiles = readdirSync(NPC_DIR).filter((f) => f.endsWith('.json'));
const npcs = {
  npcs: [],
  dialogs: {},
};
for (const f of npcFiles) {
  const data = JSON.parse(readFileSync(resolve(NPC_DIR, f), 'utf-8'));
  if (!data.npc) throw new Error(`${f}: missing top-level .npc`);
  npcs.npcs.push(data.npc);
  if (data.dialogs) Object.assign(npcs.dialogs, data.dialogs);
}
// 事件 / 敌人按目录扫描全部 JSON（加新文件自动纳入校验，不用再改这里——
// 旧版手写 tutorial+reef+bluecaves 漏了 wreck_graveyard、手写 shark+eel 漏了 spider_crab）
const EVENTS_DIR = resolve(ROOT, 'src/data/events');
const events = readdirSync(EVENTS_DIR)
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => JSON.parse(readFileSync(resolve(EVENTS_DIR, f), 'utf-8')).events ?? []);

const ENEMIES_DIR = resolve(ROOT, 'src/data/enemies');
const enemyData = readdirSync(ENEMIES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(resolve(ENEMIES_DIR, f), 'utf-8')));
const enemies = {
  enemies: enemyData.flatMap((d) => d.enemies ?? []),
  combatEncounters: enemyData.flatMap((d) => d.combatEncounters ?? []),
};
const upgrades = load('src/data/upgrades.json');
const lighthouseUpgrades = load('src/data/lighthouse_upgrades.json');
const zones = load('src/data/zones.json').zones;
const chartPois = load('src/data/chart_pois.json');

const ITEM_IDS = new Set(items.map((i) => i.id));
const EVENT_IDS = new Set(events.map((e) => e.id));
const COMBAT_IDS = new Set((enemies.combatEncounters ?? []).map((c) => c.id));
const ENEMY_IDS = new Set((enemies.enemies ?? []).map((e) => e.id));
const ZONE_IDS = new Set(zones.map((z) => z.id));
const UPGRADE_IDS = new Set(upgrades.lines.flatMap((l) => l.upgrades.map((u) => u.id)));
const LIGHTHOUSE_UPGRADE_IDS = new Set(
  (lighthouseUpgrades.tracks ?? []).flatMap((t) => (t.upgrades ?? []).map((u) => u.id)),
);
const RUIN_IDS = new Set((lighthouseUpgrades.ruins ?? []).map((r) => r.id));

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
  if (out.restoreRuinId && !RUIN_IDS.has(out.restoreRuinId))
    errors.push(`${ctx}: restoreRuinId ${out.restoreRuinId} not found`);
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

// —— 4b. 升级账单材料引用（Phase A 全局升级 + Phase B 灯塔设施）——
// cost = { materials:[{itemId,qty}], gold }；材料 itemId 必须是真物品（拼错→静默买不起）。
function checkUpgradeCost(u, ctx) {
  err(u.cost && Array.isArray(u.cost.materials) && typeof u.cost.gold === 'number',
    `${ctx}: cost 应为 { materials:[{itemId,qty}], gold:number }`);
  for (const m of u.cost?.materials ?? []) {
    err(ITEM_IDS.has(m.itemId), `${ctx}: 账单材料 ${m.itemId} 不存在`);
    err(typeof m.qty === 'number' && m.qty > 0, `${ctx}: 材料 ${m.itemId} qty 应 > 0`);
  }
}
for (const line of upgrades.lines)
  for (const u of line.upgrades) checkUpgradeCost(u, `upgrade ${u.id}`);
for (const track of lighthouseUpgrades.tracks ?? [])
  for (const u of track.upgrades ?? []) checkUpgradeCost(u, `lighthouse ${u.id}`);

// —— 4c. 灯塔废弃点（修复账单 + 结果灯塔字段，基建地图 Phase C）——
for (const ruin of lighthouseUpgrades.ruins ?? []) {
  checkUpgradeCost(ruin, `ruin ${ruin.id}`); // ruin.cost 同 UpgradeCost 形状
  const r = ruin.result;
  err(
    r && typeof r.id === 'string' && typeof r.name === 'string' &&
      typeof r.mapX === 'number' && typeof r.mapY === 'number' && typeof r.level === 'number',
    `ruin ${ruin.id}: result 应含 id/name/mapX/mapY/level`,
  );
}

// —— 5. zones ——
for (const z of zones) {
  err(z.generation === 'random' || z.generation === 'linearScripted',
    `zone ${z.id}: bad generation ${z.generation}`);
  if (z.generation === 'linearScripted')
    err(z.scriptedStartEventId && EVENT_IDS.has(z.scriptedStartEventId),
      `zone ${z.id}: scriptedStartEventId ${z.scriptedStartEventId} not found`);
}

// —— 5b. 数据文件注册完整性 ——
// 加了 JSON 却忘在引擎里 import = 静默不生效（最难查的一类 bug，纯 playthrough 也测不到）。
// 强制：data 目录里每个 JSON 都必须出现在对应 registrar 的源码里。
function assertRegistered(dataDirRel, registrarRel, label) {
  const files = readdirSync(resolve(ROOT, dataDirRel)).filter((f) => f.endsWith('.json'));
  const src = readFileSync(resolve(ROOT, registrarRel), 'utf-8');
  for (const f of files) {
    err(src.includes(f), `${label}：${dataDirRel}/${f} 未在 ${registrarRel} 注册（import 缺失 → 引擎静默不生效）`);
  }
}
assertRegistered('src/data/events', 'src/engine/zones.ts', 'event 文件');
// 敌人改"目录自动加载"（敌人库 SPEC 支柱三）：注册器从 combat.ts 手动 import 迁到生成的
// registry.generated.ts；漏 regen 会被这里 + check-enemy-refs（registry 过期门）双重拦下。
assertRegistered('src/data/enemies', 'src/data/enemies/registry.generated.ts', 'enemy 文件');
assertRegistered('src/data/npcs', 'src/engine/dialog.ts', 'NPC 文件');

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
// 起始事件从 zones.json 再生（别手钉 id——St0 起脚本链头是 tutorial.prologue 半本日志开场钩，
// 以后再换开场也不用回来改这里）；默认每步选 options[0]，prologue 两个选项都接 descent。
const tutorialZone = zones.find((z) => z.id === 'zone.east_reef');
err(tutorialZone?.scriptedStartEventId, '教学 zone 应有 scriptedStartEventId');
let evId = tutorialZone.scriptedStartEventId;
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
  for (const f of out.setProfileFlags ?? []) profileFlags.add(f); // 持久 profile flag（story.ch1.hook 走这条）
  if (out.endDive === 'forceAscend' || out.endDive === 'death') {
    endReason = out.endDive;
    break;
  }
  if (!out.triggerEventId) break;
  evId = out.triggerEventId;
  if (out.deltas?.nitrogen) {} // ignore
}
err(endReason === 'forceAscend', `教学关：应 forceAscend，实际 ${endReason}`);
err(profileFlags.has('story.ch1.hook'),
  '教学关：半本日志开场钩应在链上置位 story.ch1.hook（St0·engine/story.ts CH1_HOOK_FLAG）');

profileFlags.add('flag.tutorial_complete'); // 模拟最终读日志后设置

// —— 6b. 教学完成后，Aldo 应该开放旧灯塔礁 ——
log.push('\n--- 教学后回港 ---');
dialog = findDialog('aldo.briefing');
const visible = dialog.choices.filter((c) => checkCond(c.visibleIf));
const labels = visible.map(c => c.label).join(' / ');
log.push(`briefing 可见选项: ${labels}`);
// 海图取代了旧 zone 下拉：briefing 教学后应给 open_chart（而非逐个列 zone）
const openChart = visible.find(c => c.effects?.some(e => e.kind === 'openChart'));
err(openChart, '教学完成后 briefing 应有 open_chart 选项（海图取代了 zone 下拉）');

// —— 6b'. 海图 POI 数据：引用完整性 + 关键点位/门控 ——
log.push('\n--- 海图 POI 数据 ---');
const anchors = chartPois.anchors ?? [];
const templates = chartPois.roamingTemplates ?? [];
for (const p of [...anchors, ...templates]) {
  const tag = p.id ?? p.templateId;
  err(ZONE_IDS.has(p.zoneId), `海图 POI ${tag}: zoneId ${p.zoneId} 不存在`);
  if (p.requiresUpgrade) err(UPGRADE_IDS.has(p.requiresUpgrade), `海图 POI ${tag}: requiresUpgrade ${p.requiresUpgrade} 不存在`);
  if (p.requiresLighthouseUpgrade) err(LIGHTHOUSE_UPGRADE_IDS.has(p.requiresLighthouseUpgrade), `海图 POI ${tag}: requiresLighthouseUpgrade ${p.requiresLighthouseUpgrade} 不存在`);
}
const lhAnchor = anchors.find((p) => p.zoneId === 'zone.old_lighthouse_reef');
err(lhAnchor, '海图应有旧灯塔礁 anchor');
err(lhAnchor && (lhAnchor.requiresFlags ?? []).includes('flag.tutorial_complete'),
  '旧灯塔礁 anchor 应需 flag.tutorial_complete 才出现');
err(lhAnchor && lhAnchor.requiresLighthouseUpgrade === 'lighthouse.dockyard.lv1',
  '旧灯塔礁 anchor 应由家灯塔船坞（lighthouse.dockyard.lv1）门控抵达能力');
err(anchors.some((p) => p.zoneId === 'zone.blue_caves'), '海图应有蓝洞群 anchor');
err(anchors.some((p) => p.zoneId === 'zone.wreck_graveyard'), '海图应有沉船墓园 anchor');
log.push(`  anchors: ${anchors.length} / roamingTemplates: ${templates.length} ✓`);

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
console.log(`events: ${events.length}（按目录扫描 src/data/events/*.json）`);
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
