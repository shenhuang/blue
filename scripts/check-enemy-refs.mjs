#!/usr/bin/env node
// 敌人库 SPEC（docs/spec/深海回响_敌人库_SPEC.md §6/§7）的机制门——把"约定"变成会在
// `npm run regress` 里失败的检查。纯读 JSON·无 TS 依赖。任一不过 → exit 1。
//
// 五条门：
//   (a) registry 不过期    —— registry.generated.ts 与 src/data/enemies/*.json 一致（调 gen --check）。
//   (b) 引用完整           —— 每个 combatEncounter 引用的敌人 defId（含增援池）都已注册。
//   (c) 无孤儿敌人         —— 每只敌人 ≥1 bands 且 ≥1 biomes（否则 pickEnemy 永选不中＝死库存）。
//       (c2) boss/miniboss phases 降序；(c3) 水鬼 skinLoot 形状 + defaultSkin∈skinLoot。
//   (d) 有 baseline        —— 每只敌人被 ≥1 个 scenarios/combat/*.json 实跑覆盖。
//   (e) flee/scare 零掉落  —— #244 裁决：材料只走 kill——任何 loot 表（def.loot 与 skinLoot 皮囊变体）
//       的 victoryModifier.flee / .scare 一旦写成非 0 → 红（逃跑/吓退仍是有效脱离结局·只是不掉料）。
//
// 这是 §5 两条自动化入库工作流（描述→实装 / 定时生成）的"绿门"：绿才算"完成"。

import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const ENEMIES_DIR = join(ROOT, 'src', 'data', 'enemies');
const COMBAT_SCEN_DIR = join(ROOT, 'scenarios', 'combat');

const errors = [];

// —— 读全部敌人文件 ——
const enemyFiles = readdirSync(ENEMIES_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

/** @type {{id:string,bands:string[],biomes:string[],file:string}[]} */
const enemyDefs = [];
/** @type {{id:string,refIds:string[],file:string}[]} */
const encounters = [];

/** 深扫一个对象，收集所有敌人 defId 引用：key="defId" 的字符串值 + addFromPool/reinforcementPool 数组里的字符串。 */
function collectDefIdRefs(node, acc) {
  if (Array.isArray(node)) {
    for (const v of node) collectDefIdRefs(v, acc);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'defId' && typeof v === 'string') acc.push(v);
      else if ((k === 'addFromPool' || k === 'reinforcementPool') && Array.isArray(v)) {
        for (const s of v) if (typeof s === 'string') acc.push(s);
      } else collectDefIdRefs(v, acc);
    }
  }
}

/** 深扫收集所有 enemyRef 描述符（key==='enemyRef' 的对象值·敌人库 SPEC §4 支柱二）。 */
function collectEnemyRefs(node, acc) {
  if (Array.isArray(node)) {
    for (const v of node) collectEnemyRefs(v, acc);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'enemyRef' && v && typeof v === 'object') acc.push(v);
      else collectEnemyRefs(v, acc);
    }
  }
}

for (const f of enemyFiles) {
  let data;
  try {
    data = JSON.parse(readFileSync(join(ENEMIES_DIR, f), 'utf8'));
  } catch (e) {
    errors.push(`[json] ${f} 解析失败：${e.message}`);
    continue;
  }
  for (const e of data.enemies ?? []) {
    enemyDefs.push({
      id: e.id,
      bands: Array.isArray(e.bands) ? e.bands : [],
      biomes: Array.isArray(e.biomes) ? e.biomes : [],
      role: typeof e.role === 'string' ? e.role : undefined,
      threat: typeof e.threat === 'number' ? e.threat : 0,
      threatTier: typeof e.threatTier === 'string' ? e.threatTier : undefined,
      phases: Array.isArray(e.phases) ? e.phases : undefined,
      hasSkinLoot: Object.prototype.hasOwnProperty.call(e, 'skinLoot'),
      skinLoot: e.skinLoot,
      loot: e.loot,
      defaultSkin: e.defaultSkin,
      headEnrage: e.headEnrage,
      // 动态产出的 defId（warrenReinforce.eggDefId·lay 产卵）：被覆盖的产出者会在战斗中生成它们 ⇒
      // baseline 覆盖到产出者即传递覆盖到产物（见下 (d) 传递闭包）。droneReplenish 已退役（#271→繁殖储备节流）。
      spawnChildren: [
        ...(e.warrenReinforce?.eggDefId ? [e.warrenReinforce.eggDefId] : []),
      ],
      file: f,
    });
  }
  for (const c of data.combatEncounters ?? []) {
    const refIds = [];
    collectDefIdRefs(c, refIds);
    const enemyRefs = [];
    collectEnemyRefs(c, enemyRefs);
    encounters.push({
      id: c.id,
      refIds,
      enemyRefs,
      // 链鳗（分节实体·c4 用）：按序标记 + 节序成员（保序·头在末端）。
      attackInOrder: c.attackInOrder === true,
      members: Array.isArray(c.party?.members) ? c.party.members : [],
      file: f,
    });
  }
}

const enemyIds = new Set(enemyDefs.map((e) => e.id));

// —— (a) registry 不过期 ——
try {
  execFileSync('node', [join(HERE, 'gen-enemy-registry.mjs'), '--check'], { stdio: 'pipe' });
} catch {
  errors.push('[registry] registry.generated.ts 过期（src/data/enemies/ 有增删未同步）。运行: npm run gen:enemies');
}

// —— (b) 引用完整 ——
for (const enc of encounters) {
  for (const ref of enc.refIds) {
    if (!enemyIds.has(ref)) {
      errors.push(`[ref] encounter ${enc.id}（${enc.file}）引用未注册敌人 defId=${ref}`);
    }
  }
}

// —— (b2) enemyRef 可解析（每个描述符至少匹配一只敌人·否则运行期 party 会空·镜像 enemyLibrary.matchEnemies） ——
function threatTierOf(d) {
  if (d.threatTier) return d.threatTier;
  if (d.threat <= 3) return 'low';
  if (d.threat <= 6) return 'mid';
  return 'high';
}
function refMatchCount(ref) {
  return enemyDefs.filter((d) => {
    if (ref.band && !d.bands.includes(ref.band)) return false;
    if (ref.biome && !d.biomes.includes(ref.biome)) return false;
    if (ref.role && d.role !== ref.role) return false;
    if (ref.threatTier && threatTierOf(d) !== ref.threatTier) return false;
    return true;
  }).length;
}
for (const enc of encounters) {
  for (const ref of enc.enemyRefs ?? []) {
    if (refMatchCount(ref) === 0) {
      errors.push(`[enemyRef] encounter ${enc.id}（${enc.file}）的 enemyRef 匹配不到任何敌人：${JSON.stringify(ref)}`);
    }
  }
}

// —— (c) 无孤儿敌人 ——
for (const e of enemyDefs) {
  if (e.bands.length === 0) errors.push(`[orphan] ${e.id}（${e.file}）缺 bands —— pickEnemy 永选不中`);
  if (e.biomes.length === 0) errors.push(`[orphan] ${e.id}（${e.file}）缺 biomes`);
}

// —— (c2) boss/miniboss phases 降序验证 ——
// 约定：phases 必须以 hpThreshold 降序排列（[0.6, 0.3, 0.1]）。
// 错序时引擎 maybeBossPhaseShift 会跳过本应触发的阶段，数据侧拦截优于运行时静默错误。
for (const e of enemyDefs) {
  if (e.role !== 'boss' && e.role !== 'miniboss') continue;
  if (!e.phases || e.phases.length < 2) continue;
  for (let i = 1; i < e.phases.length; i++) {
    if (e.phases[i - 1].hpThreshold <= e.phases[i].hpThreshold) {
      errors.push(
        `[phases] ${e.id}（${e.file}）phases 未降序：` +
          `phases[${i - 1}].hpThreshold=${e.phases[i - 1].hpThreshold} ≤ ` +
          `phases[${i}].hpThreshold=${e.phases[i].hpThreshold}（应降序·最高阈值在 index 0）`,
      );
    }
  }
}

// —— (c3) 水鬼 skinLoot 形状 + defaultSkin∈skinLoot ——
// 约定（深水区 SPEC §5 / boss 设计蓝图「水鬼新定位」）：声明 skinLoot 的敌人（水鬼类）——
// skinLoot 必须是非空对象（皮囊 id → LootTable）；每个皮囊变体须是合法 LootTable（guaranteed/rolls
// 至少其一为数组·entry 形如 {itemId:string, qty:[n,n]}）；defaultSkin（若有）必须是 skinLoot 的一个 key。
// 引擎 effectiveLoot 按 EnemyInstance.wornSkin 命中此表替换 loot——数据侧拦截优于运行时静默回落 def.loot。
function isLootTableShape(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const g = v.guaranteed;
  const r = v.rolls;
  if (g !== undefined && !Array.isArray(g)) return false;
  if (r !== undefined && !Array.isArray(r)) return false;
  if (g === undefined && r === undefined) return false; // 至少一个 loot 数组
  const entries = [...(Array.isArray(g) ? g : []), ...(Array.isArray(r) ? r : [])];
  for (const ent of entries) {
    if (!ent || typeof ent.itemId !== 'string') return false;
    if (
      !Array.isArray(ent.qty) ||
      ent.qty.length !== 2 ||
      typeof ent.qty[0] !== 'number' ||
      typeof ent.qty[1] !== 'number'
    ) {
      return false;
    }
  }
  return true;
}
for (const e of enemyDefs) {
  if (!e.hasSkinLoot) continue;
  const sl = e.skinLoot;
  if (!sl || typeof sl !== 'object' || Array.isArray(sl) || Object.keys(sl).length === 0) {
    errors.push(`[skinLoot] ${e.id}（${e.file}）skinLoot 须为非空对象（皮囊 id → LootTable）`);
    continue;
  }
  for (const [skin, table] of Object.entries(sl)) {
    if (!isLootTableShape(table)) {
      errors.push(
        `[skinLoot] ${e.id}（${e.file}）皮囊 "${skin}" 的 loot 表形状非法（需 guaranteed/rolls 数组·entry={itemId,qty:[n,n]}）`,
      );
    }
  }
  if (e.defaultSkin !== undefined && !(e.defaultSkin in sl)) {
    errors.push(`[skinLoot] ${e.id}（${e.file}）defaultSkin="${e.defaultSkin}" 不是 skinLoot 的 key`);
  }
}

// —— (c4) 链鳗「按序」遭遇节序合法 + headEnrage 形状 ——
// 约定（boss 设计蓝图 2026-06-21「链鳗（分节实体）」）：attackInOrder=true 的 encounter 是分节链——
// party.members 即节序（**头在末端**·index 0 = 最前节·逐节解锁）。把「按序」约定落成会红的门：
//   ① ≥2 节（<2 节排序无意义）。
//   ② 末节（头节）须写死 defId（非 enemyRef·头必须确定）且其 def 带 headEnrage（成为最前存活节时狂暴）。
//   ③ 任何声明 headEnrage 的 def——headEnrage 须含非空 transitionText；attacksOverride（若有）须为数组。
// 引擎 maybeChainEelEnrage 对「最前存活节带 headEnrage」者施加 enrage；数据侧拦截缺头/错配优于运行时哑火。
const headEnrageIds = new Set(enemyDefs.filter((d) => d.headEnrage !== undefined).map((d) => d.id));
for (const e of enemyDefs) {
  if (e.headEnrage === undefined) continue;
  const h = e.headEnrage;
  if (!h || typeof h !== 'object' || Array.isArray(h) || typeof h.transitionText !== 'string' || !h.transitionText) {
    errors.push(`[headEnrage] ${e.id}（${e.file}）headEnrage 须含非空 transitionText`);
  }
  if (h && typeof h === 'object' && h.attacksOverride !== undefined && !Array.isArray(h.attacksOverride)) {
    errors.push(`[headEnrage] ${e.id}（${e.file}）headEnrage.attacksOverride 须为数组`);
  }
}
for (const enc of encounters) {
  if (!enc.attackInOrder) continue;
  if (enc.members.length < 2) {
    errors.push(`[ordered] encounter ${enc.id}（${enc.file}）attackInOrder 需 ≥2 节，实际 ${enc.members.length}`);
    continue;
  }
  const head = enc.members[enc.members.length - 1];
  if (!head || typeof head.defId !== 'string') {
    errors.push(`[ordered] encounter ${enc.id}（${enc.file}）末节（头节）须写死 defId（非 enemyRef·头必须确定）`);
  } else if (!headEnrageIds.has(head.defId)) {
    errors.push(
      `[ordered] encounter ${enc.id}（${enc.file}）末节 ${head.defId} 缺 headEnrage（头节须配「成为最前存活节时」的狂暴覆盖）`,
    );
  }
}

// —— (d) 有 baseline ——
/** combatId → 该 encounter 的全部敌人 defId */
const encRefById = new Map(encounters.map((e) => [e.id, e.refIds]));
const covered = new Set();
let scenFiles = [];
try {
  scenFiles = readdirSync(COMBAT_SCEN_DIR).filter((f) => f.endsWith('.json'));
} catch {
  errors.push(`[baseline] 找不到 ${COMBAT_SCEN_DIR}`);
}
for (const f of scenFiles) {
  let s;
  try {
    s = JSON.parse(readFileSync(join(COMBAT_SCEN_DIR, f), 'utf8'));
  } catch (e) {
    errors.push(`[json] scenarios/combat/${f} 解析失败：${e.message}`);
    continue;
  }
  if (s.combatId && encRefById.has(s.combatId)) {
    for (const d of encRefById.get(s.combatId)) covered.add(d);
  }
  if (Array.isArray(s.enemyDefIds)) for (const d of s.enemyDefIds) covered.add(d);
}
// 传递闭包：被 baseline 覆盖的产出者，其战斗中动态生成的 defId（spawnChildren）也算被覆盖——
// 它们由已覆盖的产出者实跑生成（如 warren_egg 由女王 warrenReinforce 产下·warren_queen__reinforce_egg_lifecycle）。
for (let grew = true; grew; ) {
  grew = false;
  for (const e of enemyDefs) {
    if (!covered.has(e.id)) continue;
    for (const child of e.spawnChildren ?? []) {
      if (!covered.has(child)) { covered.add(child); grew = true; }
    }
  }
}
for (const e of enemyDefs) {
  if (!covered.has(e.id)) {
    errors.push(`[baseline] ${e.id} 无 combat baseline（scenarios/combat/ 无场景覆盖它）`);
  }
}

// —— (e) flee/scare 零掉落（#244 裁决机制化）——
// 作者拍板（CHANGELOG 5e0a64d「逃跑/吓退不再给动物材料」）：flee/scare 掉率削弱「战斗=进度」+
// 主题怪（逃了怎么采到材料）+ 配合 stalker 可刷 → 材料掉率只走 kill。victoryConditions 仍保留
// flee/scare 三态（有效脱离结局），但所有 loot 表（def.loot 与 skinLoot 各皮囊变体）的
// victoryModifier.flee / .scare 若写出必须为 0；缺省键＝无此路径掉率·放行。
for (const e of enemyDefs) {
  const tables = [['loot', e.loot]];
  if (e.skinLoot && typeof e.skinLoot === 'object' && !Array.isArray(e.skinLoot)) {
    for (const [skin, table] of Object.entries(e.skinLoot)) tables.push([`skinLoot["${skin}"]`, table]);
  }
  for (const [name, table] of tables) {
    const vm = table && typeof table === 'object' && !Array.isArray(table) ? table.victoryModifier : undefined;
    if (!vm || typeof vm !== 'object') continue;
    for (const path of ['flee', 'scare']) {
      if (vm[path] !== undefined && vm[path] !== 0) {
        errors.push(
          `[fleeLoot] ${e.id}（${e.file}）${name}.victoryModifier.${path}=${vm[path]}` +
            `——#244 裁决：逃跑/吓退不掉材料·须为 0（材料掉率只走 kill）`,
        );
      }
    }
  }
}

// —— 汇报 ——
if (errors.length) {
  console.error(`✗ check-enemy-refs：${errors.length} 处问题`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(
  `✓ check-enemy-refs：${enemyDefs.length} 敌人 / ${encounters.length} encounter · 引用完整 · 无孤儿 · boss 阶段降序 · 水鬼 skinLoot 合规 · 链鳗按序节序合规 · 全有 baseline · flee/scare 零掉落 · registry 最新`,
);
