#!/usr/bin/env node
// 事件选项 check 单一来源 lint（CHANGELOG #109·品味评审① 根治版；保守版历史见 #107）。
//
// 根治后的世界：label 回归**纯 fiction**，判定徽章由 EventView 从 `check.{stat,dc}` 渲染
// （单一来源·永不与数据失真）；「隐藏判定」的设计权走 `hideCheck: true`（徽章不显示）。
// 本 lint 是防回潮的门：
//   1. label 里**禁止**出现「（<stat 词> vs <N>）」式标注——双写病灶一旦回潮即红
//      （retune DC 时 label 又得手抄一遍＝迟早对玩家说谎·#107 的病根）；
//   2. `hideCheck` 只允许出现在**有 check** 的选项上（对不存在的判定「隐藏」＝数据噪声，红）。
//
// 在 scripts/regress.mjs 注册为 check-event-dc 任务（纯 node·与 check-boundaries 同类）。
//
// 跑法： node scripts/check-event-dc.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const EVENTS_DIR = resolve(ROOT, 'src/data/events');

// 「（理智 vs 60）」式标注；宽松匹配任意 1-6 字词（新 stat 也别想混进 label）。全角括号；vs 两侧空白宽松。
const ANN_RE = /（[^（）]{1,6}?\s*vs\s*\d+）/g;

const violations = [];
let optTotal = 0;
let checkTotal = 0;
let hiddenTotal = 0;

for (const name of readdirSync(EVENTS_DIR).filter((n) => n.endsWith('.json')).sort()) {
  const file = join('src/data/events', name);
  const parsed = JSON.parse(readFileSync(resolve(ROOT, file), 'utf-8'));
  const events = Array.isArray(parsed) ? parsed : (parsed.events ?? []);
  for (const ev of events) {
    for (const opt of ev.options ?? []) {
      optTotal++;
      const where = `${file} → ${ev.id} / ${opt.id}`;
      const anns = [...(opt.label ?? '').matchAll(ANN_RE)];
      if (anns.length > 0) {
        violations.push(
          `${where}\n      label 含标注「${anns[0][0]}」——双写回潮。判定徽章由 EventView 从 check.{stat,dc} 渲染，label 只写 fiction`,
        );
      }
      if (opt.check) checkTotal++;
      if (opt.hideCheck !== undefined) {
        hiddenTotal++;
        if (!opt.check) {
          violations.push(`${where}\n      hideCheck 出现在没有 check 的选项上（隐藏不存在的判定＝数据噪声）`);
        }
      }
    }
  }
}

if (violations.length) {
  console.error('✘ 事件选项 check 单一来源被破坏\n');
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    `\n共 ${violations.length} 处。label 是纯 fiction：别写「（理智 vs N）」——徽章由 UI 从 check 渲染；` +
      `\n想对玩家隐藏判定 → 选项加 "hideCheck": true（仅限有 check 的选项）。`,
  );
  process.exit(1);
}

console.log(
  `✓ 事件 check 单一来源：label 零标注（扫 ${optTotal} 选项）；${checkTotal} 个 check 由 UI 渲染徽章` +
    (hiddenTotal ? `，其中 ${hiddenTotal} 个 hideCheck 隐藏判定（设计权）` : ''),
);
process.exit(0);
