#!/usr/bin/env node
// 数据结构门（保守·零误报·2026-06-26）。
//
// 背景：`src/data/**` 与 `scenarios/**` 下全是 hand-authored JSON。两类静默失败此前只在
// 下游 playthrough 里炸成「难定位的怪错」、或干脆不报：
//   ① 某个 *.json 写出语法错误（多逗号 / 漏引号）——import 它的任务一栈红，错误信息指不到行。
//   ② id 集合里两条目同 id——后写覆盖先写（Map/对象建表时），内容白写、无任何报错。
// 这道门把两件事焊成 regress 门（CLAUDE.md 顶部原则：能变成 `npm run regress` 里会失败的检查就那样做），
// 与 check-event-poi / check-boundaries 同类：纯 node·无依赖·进程隔离友好。
//
// 范围（刻意保守——宁可少查、不可误报）：
//   1) parse-all：扫到的每个 *.json 必须 JSON.parse 通过（快速结构预检）。
//   2) 重复 id：递归找「全部子项都带同一个 identity key 的数组」，查同数组内该 key 是否撞值。
//      identity key 白名单 = ID_KEYS（见下）——只收**确定是唯一身份键**的，名字各文件不一：
//        · id         —— events / enemies / items / pois.anchors / upgrades / zones / lore … （422 个数组·当前 0 撞）
//        · templateId —— chart_pois.roamingTemplates 的 roaming 模板身份（1 个数组·当前 0 撞）
//        · caveId     —— caves.json 的洞身份（1 个数组·当前 0 撞）
//      **刻意排除**的 key（它们是外键/分组引用·不是身份·同值合法→查了会误报）：
//        · zoneId  —— 多个 POI 共享一个 zone（chart_pois.ch1.anchors 里 whalefall 三条目同 zone·合法）。
//        · itemId  —— loot / 配方成本清单里同一物品可合法出现多次（90 个数组·全是外键引用）。
//        · 其余未列入 ID_KEYS 的 key 一律不查（保守默认）。
//   不做 JSON-Schema / 必填字段校验——无法保证当前数据零误报的检查一律不加。
//
// 跑法： node scripts/check-data-schema.mjs    或在 npm run regress 里作为 check-data-schema 任务。
// 退出码：全过=0，任一语法错误 / 重复 id =1。

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

// ── 配置 ──
// 扫描根（相对仓库根）。两处全 hand-authored JSON。
const SCAN_ROOTS = ['src/data', 'scenarios'];
// identity key 白名单（只收确定唯一身份键·见脚本头注的排除理由）。顺序无关。
export const ID_KEYS = ['id', 'templateId', 'caveId'];

/**
 * 纯逻辑：在一棵已 parse 的 JSON 树里找「数组内 identity key 撞值」。无 IO·便于单测。
 *
 * 判定一个数组算「identity 集合」的条件（保守）：
 *   - 该数组**所有** object 子项都带同一个 ID_KEYS 里的 key，且其值是字符串/数字；
 *   - 且 object 子项 ≥ 2（单元素无所谓重复）。
 * 满足则在该数组内按该 key 聚合计数，出现 ≥2 即记为一处违规。
 * 「所有子项都带」这条要求避免把「混合数组里碰巧两条带 id」误判（保守优先）。
 *
 * @param {unknown} root      已 JSON.parse 的根节点
 * @param {string}  file      展示用文件名（相对路径）
 * @param {string[]} idKeys   identity key 白名单（默认 ID_KEYS）
 * @returns {{file:string, path:string, key:string, value:string, count:number}[]}
 *          每处重复一条；path 是该数组在树里的定位串（如 `.ch1.anchors`）。
 */
export function findDuplicateIds(root, file, idKeys = ID_KEYS) {
  const out = [];
  const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const isIdVal = (v) => typeof v === 'string' || typeof v === 'number';

  const walk = (node, path) => {
    if (Array.isArray(node)) {
      const objs = node.filter(isPlainObject);
      if (objs.length >= 2) {
        for (const key of idKeys) {
          // 仅当**所有** object 子项都带这个 key（且值是 id 标量）才视为 identity 集合。
          if (objs.every((o) => isIdVal(o[key]))) {
            const seen = new Map(); // value → count
            for (const o of objs) {
              const v = o[key];
              seen.set(v, (seen.get(v) ?? 0) + 1);
            }
            for (const [value, count] of seen) {
              if (count > 1) out.push({ file, path: path || '(root)', key, value: String(value), count });
            }
          }
        }
      }
      node.forEach((child, i) => walk(child, `${path}[${i}]`));
    } else if (isPlainObject(node)) {
      for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
    }
  };

  walk(root, '');
  return out;
}

// ── IO ──（被 import 时不执行）
/** 递归收集 dir 下全部 *.json 绝对路径。 */
function findJsonFiles(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // 根不存在 → 跳过（不破坏非常规环境）
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(findJsonFiles(p));
    else if (e.isFile() && e.name.endsWith('.json')) out.push(p);
  }
  return out.sort();
}

// ── CLI ──
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  const parseErrors = []; // {file, msg}
  const duplicates = []; // findDuplicateIds 的并集
  let filesScanned = 0;
  let collectionsChecked = 0; // 命中 identity 集合的数组数（仅供 ✓ 摘要）

  // 为「命中 identity 集合的数组数」单独数一遍（与 findDuplicateIds 同判定·只为摘要透明度）。
  const countIdCollections = (node) => {
    let n = 0;
    const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
    const isIdVal = (v) => typeof v === 'string' || typeof v === 'number';
    const walk = (x) => {
      if (Array.isArray(x)) {
        const objs = x.filter(isPlainObject);
        if (objs.length >= 2) {
          for (const key of ID_KEYS) {
            if (objs.every((o) => isIdVal(o[key]))) {
              n++;
              break; // 一个数组最多记一次（即便多个 key 都满足·罕见）
            }
          }
        }
        for (const c of x) walk(c);
      } else if (isPlainObject(x)) {
        for (const v of Object.values(x)) walk(v);
      }
    };
    walk(node);
    return n;
  };

  for (const root of SCAN_ROOTS) {
    for (const abs of findJsonFiles(resolve(ROOT, root))) {
      const rel = relative(ROOT, abs);
      filesScanned++;
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(abs, 'utf-8'));
      } catch (e) {
        parseErrors.push({ file: rel, msg: e instanceof Error ? e.message : String(e) });
        continue; // 语法坏的文件无法做 id 检查·记错跳过
      }
      collectionsChecked += countIdCollections(parsed);
      duplicates.push(...findDuplicateIds(parsed, rel));
    }
  }

  let failed = false;

  if (parseErrors.length) {
    failed = true;
    console.error(`✘ JSON 解析失败 ${parseErrors.length} 处：\n`);
    for (const { file, msg } of parseErrors) console.error(`  ${file}\n      ${msg}`);
    console.error('');
  }

  if (duplicates.length) {
    failed = true;
    console.error(`✘ 重复 id ${duplicates.length} 处（同数组内身份键撞值＝后写覆盖先写·内容白写）：\n`);
    for (const d of duplicates) {
      console.error(`  ${d.file}  ${d.path}\n      ${d.key}「${d.value}」出现 ${d.count} 次`);
    }
    console.error(
      '\n  同一 identity 集合里两条目同 id ⇒ 建表/建 Map 时后者静默覆盖前者。' +
        '\n  怎么办：改掉其中一条的 id（或合并两条目）。',
    );
  }

  if (failed) process.exit(1);

  console.log(
    `✓ 数据结构门：${filesScanned} 个 *.json 全部解析通过` +
      `（${SCAN_ROOTS.join(' + ')}）；` +
      `检查了 ${collectionsChecked} 个 id 集合（键 ${ID_KEYS.join('/')}），无重复 id。`,
  );
  process.exit(0);
}
