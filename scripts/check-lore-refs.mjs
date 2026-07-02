#!/usr/bin/env node
// 见闻引用 ratchet 门（loreEntry → src/data/lore.json 登记集·2026-07-02）。
//
// 背景：事件/敌人数据里 `loreEntry: "lore.xxx"` 把 id 写进 profile.loreEntries（Set·持久），
// 显示文案由 src/data/lore.json 登记（engine/lore.ts getLoreEntry）。**未登记 id 是设计内 backlog**
// （约百余条散落 lore.* 待批补文案·getLoreEntry 返回 undefined、LoreView 静默跳过不崩·见 lore.json _doc）。
// 全量红门会把存量 backlog 全炸出来挡路；完全不查则新 typo（拼错 id ⇒ 图鉴永远不显示＝内容白写）
// 也静默放行。所以做成 **ratchet（棘轮）门**：
//   - 存量悬空 id 全量落在 scripts/lore-refs-baseline.json（排序去重·带 _doc）＝当下 backlog 快照。
//   - 新出现的悬空 id（不在登记集也不在基线）→ 红（多半 typo·要么登记要么改对·**别加进基线绕门**）。
//   - 基线里的 id 已登记 / 已不再被引用 → 软提示可收缩（不红）；跑 --update-baseline 机械收缩。
//
// 扫描面：src/data/**/*.json 里所有 key==='loreEntry' 的字符串值（事件 outcome、敌人 def 都算——
// 引擎侧同一条写入通路）。风格同 check-event-poi（纯 node·无 TS 依赖）；纯决策函数导出便于单测。
//
// 跑法： node scripts/check-lore-refs.mjs
//        node scripts/check-lore-refs.mjs --update-baseline   # 重算基线（初始化/收缩·别用来洗白新 typo）

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA_DIR = resolve(ROOT, 'src/data');
const LORE_FILE = resolve(ROOT, 'src/data/lore.json');
const BASELINE_FILE = resolve(__dirname, 'lore-refs-baseline.json');

/** 递归收集 JSON 里所有 loreEntry 引用：id → 引用它的文件集合（相对 ROOT）。 */
function collectLoreRefs(node, file, out) {
  if (Array.isArray(node)) {
    for (const v of node) collectLoreRefs(v, file, out);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'loreEntry' && typeof v === 'string') {
        if (!out.has(v)) out.set(v, new Set());
        out.get(v).add(file);
      } else collectLoreRefs(v, file, out);
    }
  }
}

function walkJsonFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walkJsonFiles(full, out);
    else if (e.name.endsWith('.json')) out.push(full);
  }
  return out;
}

/**
 * 纯决策（无 IO·便于单测）。
 * @param {string[]} refIds      数据里引用到的全部 loreEntry id（去重后）
 * @param {Set<string>} registered  lore.json 已登记 id 集
 * @param {Set<string>} baseline    ratchet 基线里的存量悬空 id 集
 * @returns {{newDangling:string[], shrinkRegistered:string[], shrinkUnreferenced:string[]}}
 *   newDangling＝新悬空（红）；shrinkRegistered＝基线 id 已登记（软·可从基线删）；
 *   shrinkUnreferenced＝基线 id 已无人引用（软·可从基线删）。
 */
export function decideLoreRefs(refIds, registered, baseline) {
  const refSet = new Set(refIds);
  const dangling = refIds.filter((id) => !registered.has(id));
  return {
    newDangling: dangling.filter((id) => !baseline.has(id)).sort(),
    shrinkRegistered: [...baseline].filter((id) => registered.has(id)).sort(),
    shrinkUnreferenced: [...baseline].filter((id) => !refSet.has(id)).sort(),
  };
}

// ── CLI ──（被 import 时不执行）
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const refs = new Map(); // id → Set(引用文件·相对 ROOT)
  for (const f of walkJsonFiles(DATA_DIR).sort()) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(f, 'utf-8'));
    } catch (e) {
      console.error(`✘ check-lore-refs：${relative(ROOT, f)} 解析失败：${e.message}`);
      process.exit(1);
    }
    collectLoreRefs(parsed, relative(ROOT, f), refs);
  }
  const registered = new Set(
    (JSON.parse(readFileSync(LORE_FILE, 'utf-8')).entries ?? []).map((e) => e.id),
  );

  if (process.argv.includes('--update-baseline')) {
    const ids = [...refs.keys()].filter((id) => !registered.has(id)).sort();
    writeFileSync(
      BASELINE_FILE,
      JSON.stringify(
        {
          _doc:
            'check-lore-refs 的 ratchet 基线：这些 loreEntry 引用尚未在 src/data/lore.json 登记' +
            '（设计内 backlog·engine/lore.ts 对未登记 id 静默跳过·LoreView 不显示不崩）。' +
            '新悬空 id（不在本清单）→ 门红（多半 typo）——新内容要么登记要么改对，**别往这里加 id 绕门**；' +
            '补登记/删引用后跑 node scripts/check-lore-refs.mjs --update-baseline 收缩。',
          ids,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`✓ 已写基线 ${relative(ROOT, BASELINE_FILE)}（${ids.length} 条存量悬空 id）`);
    process.exit(0);
  }

  if (!existsSync(BASELINE_FILE)) {
    console.error(
      `✘ check-lore-refs：缺基线 ${relative(ROOT, BASELINE_FILE)}——先跑 node scripts/check-lore-refs.mjs --update-baseline`,
    );
    process.exit(1);
  }
  const baseline = new Set(JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')).ids ?? []);
  const r = decideLoreRefs([...refs.keys()], registered, baseline);

  if (r.newDangling.length) {
    console.error('✘ 见闻引用 ratchet 门：出现**新**悬空 loreEntry id（不在 lore.json 登记集、也不在存量基线）\n');
    for (const id of r.newDangling) {
      console.error(`  ${id}\n      引用自：${[...refs.get(id)].sort().join('、')}`);
    }
    console.error(
      `\n共 ${r.newDangling.length} 处。多半是拼错 id（悬空＝图鉴永不显示＝内容白写）：` +
        `\n要么在 src/data/lore.json 登记文案，要么改成既有 id；确属新 backlog 才收进基线（--update-baseline·慎用）。`,
    );
    process.exit(1);
  }

  const shrink = [...new Set([...r.shrinkRegistered, ...r.shrinkUnreferenced])];
  if (shrink.length) {
    console.log(
      `⚠ 基线可收缩 ${shrink.length} 条（已登记 ${r.shrinkRegistered.length} / 已无引用 ${r.shrinkUnreferenced.length}）` +
        `——跑 node scripts/check-lore-refs.mjs --update-baseline（软提示·不挡门）`,
    );
  }
  console.log(
    `✓ 见闻引用 ratchet 门：${refs.size} 个 loreEntry id（登记 ${registered.size} · 存量悬空基线 ${baseline.size}）· 无新悬空 id`,
  );
  process.exit(0);
}
