#!/usr/bin/env node
// 主角语调（protagonist voice）单一来源 lint（漂移修·quirk #184·CLAUDE.md「约定落成机制」）。
//
// 背景：主角「冷静寡言·情绪只走不自主身体反应·禁直白情绪/生理戏剧化命名」这条语调约定，
// 此前只散在 docs/spec/cave_zones_spec.md（框成「洞穴 4 池」局部）+ memory，权威的剧情 SPEC §2
// 「防跨 session 漂移」反而没写 → 文档/记忆已分叉（正是「散文随 session churn 丢」的活样本）。
// 本门把**禁词**扫描焊成会红的检查；单一来源＝本文件 BANNED，剧情 SPEC §2 引用本门。
//
// 扫描面＝主角 POV 叙事：
//   src/data/events/*.json 的 body / onEnter.text / options[].{label,outcome.text}
//   + src/data/lore.json 中 kind==='journal'（主角日志）的 title/body。
// 豁免：src/data/npcs/*.json（NPC 说话·可哭可怕·非主角 POV）、kind!=='journal' 的 lore（图鉴/见闻）。
//
// 例外放行：ALLOW 白名单（照 check-boundaries overflow 白名单先例）——真要写的破例逐条登记，
// 别改 BANNED 表。语义性语调（不解释机制 / 细节优先 / 死亡不戏剧化）难可靠 lint，留写作评审
// 指引（同 quirk #167 取舍：有合法用途的不做阈值门）。
//
// 在 scripts/regress.mjs 注册为 check-protagonist-voice 任务（纯 node·与 check-event-dc 同类）。
// 跑法： node scripts/check-protagonist-voice.mjs

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const EVENTS_DIR = resolve(ROOT, 'src/data/events');
const LORE_FILE = resolve(ROOT, 'src/data/lore.json');

// 禁词（单一来源）：直白情绪命名 + 直接哭/泪/鼻子一酸。多字短语·不用裸「哭」「泪」以免误伤
// 「哭声」（环境音）/「催泪」等。来源：cave_zones_spec「禁感到害怕/心跳加速」+ [[protagonist-voice]] 记忆。
const BANNED = [
  '感到害怕', '心跳加速', '鼻子一酸',
  '眼泪', '泪水', '流泪', '落泪', '哭了', '大哭', '哭出声', '失声痛哭',
];

// 例外放行：'<where>::<禁词>'（暂空·破例逐条登记·别动 BANNED）。
const ALLOW = new Set([]);

const violations = [];
let scanned = 0;

function scan(where, text) {
  if (!text) return;
  scanned++;
  for (const w of BANNED) {
    if (text.includes(w) && !ALLOW.has(`${where}::${w}`)) {
      violations.push(
        `${where}\n      含禁词「${w}」——主角语调：情绪走不自主身体反应（手抖/耳鸣/呼吸），别直白命名。破例登记 ALLOW`,
      );
    }
  }
}

// 事件正文 / onEnter / 选项 label + outcome 文案
for (const name of readdirSync(EVENTS_DIR).filter((n) => n.endsWith('.json')).sort()) {
  const file = join('src/data/events', name);
  const parsed = JSON.parse(readFileSync(resolve(ROOT, file), 'utf-8'));
  const events = Array.isArray(parsed) ? parsed : (parsed.events ?? []);
  for (const ev of events) {
    const base = `${file} → ${ev.id}`;
    scan(`${base} / body`, ev.body);
    scan(`${base} / onEnter`, ev.onEnter?.text);
    for (const opt of ev.options ?? []) {
      scan(`${base} / ${opt.id} label`, opt.label);
      scan(`${base} / ${opt.id} outcome`, opt.outcome?.text);
    }
  }
}

// 日志页 lore（kind==='journal'·主角日志；图鉴/见闻 kind!=='journal' 豁免）
if (existsSync(LORE_FILE)) {
  const lore = JSON.parse(readFileSync(LORE_FILE, 'utf-8'));
  const entries = Array.isArray(lore) ? lore : (lore.entries ?? []);
  for (const e of entries) {
    if (e.kind !== 'journal') continue;
    scan(`src/data/lore.json → ${e.id} (journal)`, `${e.title ?? ''}\n${e.body ?? ''}`);
  }
}

if (violations.length) {
  console.error('✘ 主角语调（protagonist voice）禁词出现\n');
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    `\n共 ${violations.length} 处。单一来源＝scripts/check-protagonist-voice.mjs BANNED + 剧情 SPEC §2；` +
      `\n破例登记 ALLOW（别改 BANNED）。`,
  );
  process.exit(1);
}

console.log(`✓ 主角语调：扫 ${scanned} 段叙事文本（事件正文/选项/日志页）·零禁词`);
process.exit(0);
