#!/usr/bin/env node
// 敌人库 SPEC（docs/spec/深海回响_敌人库_SPEC.md §6/§7）的机制门——把"约定"变成会在
// `npm run regress` 里失败的检查。纯读 JSON·无 TS 依赖。任一不过 → exit 1。
//
// 四条门：
//   (a) registry 不过期    —— registry.generated.ts 与 src/data/enemies/*.json 一致（调 gen --check）。
//   (b) 引用完整           —— 每个 combatEncounter 引用的敌人 defId（含增援池）都已注册。
//   (c) 无孤儿敌人         —— 每只敌人 ≥1 bands 且 ≥1 biomes（否则 pickEnemy 永选不中＝死库存）。
//       (c2) boss/miniboss phases 降序；(c3) 尸衣者 skinLoot 形状 + defaultSkin∈skinLoot。
//   (d) 有 baseline        —— 每只敌人被 ≥1 个 scenarios/combat/*.json 实跑覆盖。
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
      defaultSkin: e.defaultSkin,
      file: f,
    });
  }
  for (const c of data.combatEncounters ?? []) {
    const refIds = [];
    collectDefIdRefs(c, refIds);
    const enemyRefs = [];
    collectEnemyRefs(c, enemyRefs);
    encounters.push({ id: c.id, refIds, enemyRefs, file: f });
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

// —— (c3) 尸衣者 skinLoot 形状 + defaultSkin∈skinLoot ——
// 约定（深水区 SPEC §5 / boss 设计蓝图「尸衣者新定位」）：声明 skinLoot 的敌人（尸衣者类）——
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
for (const e of enemyDefs) {
  if (!covered.has(e.id)) {
    errors.push(`[baseline] ${e.id} 无 combat baseline（scenarios/combat/ 无场景覆盖它）`);
  }
}

// —— 汇报 ——
if (errors.length) {
  console.error(`✗ check-enemy-refs：${errors.length} 处问题`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(
  `✓ check-enemy-refs：${enemyDefs.length} 敌人 / ${encounters.length} encounter · 引用完整 · 无孤儿 · boss 阶段降序 · 尸衣 skinLoot 合规 · 全有 baseline · registry 最新`,
);
