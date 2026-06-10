#!/usr/bin/env node
// 事件选项「check 标注」一致性 lint（CHANGELOG #107·品味评审候选①·保守版）。
//
// 双写病灶：选项 label 末尾手写「（理智 vs 60）」与同一选项 `check.dc`/`check.stat` 是两份
// 同一事实（全库 157 处）——EventView 渲染完全不读 check，retune 一次 DC、文案就在对玩家说谎。
// 根治版（label 回归纯 fiction + UI 从数据渲染 check 徽章）改 70+ 数据 label + UI 观感，
// 留作者在场的 session 拍板；本 lint 是保守版的门：**双写仍在，但两份永远相等，会红**。
//
// 规则（命中即打印 file/event/option 并退出 1）：
//   1. label 标注「（<stat 词> vs <N>）」必须有同选项 check，且 N === check.dc；
//   2. 标注的 stat 词必须与 check.stat 对应（理智=sanity / 体力=stamina / 氧气=oxygen）；
//   3. 有标注必有 check（对不存在的 check 撒谎＝最恶性）。
// 刻意不管：check 存在但 label 无标注（现 8 处·隐藏 check 是设计权，仅 info 不红）；
// 标注词表如有新 stat（如氮）→ 在 STAT_WORD 加一行（未知词会红，防静默漏检）。
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

/** 标注 stat 词 → check.stat 值。新词先加这里（未知词按违例报，防静默漏检）。 */
const STAT_WORD = { 理智: 'sanity', 体力: 'stamina', 氧气: 'oxygen' };

// 「（理智 vs 60）」式标注；捕获词与数字。全角括号；vs 两侧空白宽松。
const ANN_RE = /（([^（）]{1,6}?)\s*vs\s*(\d+)）/g;

const violations = [];
let optTotal = 0;
let annTotal = 0;
const unannotated = []; // check 存在但 label 无标注（info·不红）

for (const name of readdirSync(EVENTS_DIR).filter((n) => n.endsWith('.json')).sort()) {
  const file = join('src/data/events', name);
  const parsed = JSON.parse(readFileSync(resolve(ROOT, file), 'utf-8'));
  const events = Array.isArray(parsed) ? parsed : (parsed.events ?? []);
  for (const ev of events) {
    for (const opt of ev.options ?? []) {
      optTotal++;
      const label = opt.label ?? '';
      const check = opt.check;
      const anns = [...label.matchAll(ANN_RE)];
      if (anns.length === 0) {
        if (check) unannotated.push(`${file} → ${ev.id} / ${opt.id}`);
        continue;
      }
      annTotal += anns.length;
      const where = `${file} → ${ev.id} / ${opt.id}`;
      if (!check) {
        violations.push(`${where}\n      label 标注「${anns[0][0]}」但选项没有 check（对不存在的判定撒谎）`);
        continue;
      }
      for (const [full, word, num] of anns) {
        const expectStat = STAT_WORD[word];
        if (!expectStat) {
          violations.push(`${where}\n      标注词「${word}」不在词表（理智/体力/氧气）——新 stat 先加 STAT_WORD，别让它静默漏检`);
          continue;
        }
        if (expectStat !== check.stat) {
          violations.push(`${where}\n      标注「${full}」≠ check.stat '${check.stat}'（词不对＝对玩家谎报判定属性）`);
        }
        if (Number(num) !== check.dc) {
          violations.push(`${where}\n      标注「${full}」≠ check.dc ${check.dc}（数字不对＝retune 后文案在说谎）`);
        }
      }
    }
  }
}

if (violations.length) {
  console.error('✘ 事件选项 check 标注与数据不一致（label 双写失真）\n');
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    `\n共 ${violations.length} 处。label 里的「（理智 vs N）」必须与同选项 check.{stat,dc} 一致：` +
      `\nretune DC 时同步改 label，或删掉标注（隐藏 check 合法）；别让文案对玩家说谎。`,
  );
  process.exit(1);
}

console.log(
  `✓ 事件 check 标注一致：${annTotal} 处标注全部与 check.{stat,dc} 相符（扫 ${optTotal} 选项）` +
    (unannotated.length ? `；另 ${unannotated.length} 个 check 无标注（隐藏判定·不强制）` : ''),
);
process.exit(0);
