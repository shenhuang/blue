#!/usr/bin/env node
// 叙述禁断言主角为人类 门（大深渊结局 SPEC §5.2「假设≠断言」落成机制）。
//
// 背景：主角＝玩家投影（[[protagonist-voice]]·只写身体和环境·从不定义主角是什么），且终局揭示
// 「主角其实不是人类」依赖一条不变量——**叙述体全程从不断言主角的人类身份**。玩家/NPC 的「先入为主」
// 可以（NPC 叫你某个名字·你默认那是你的名字），但叙述自己的口不能替这个假设背书；否则终局反转会
// 「前后矛盾」穿帮。白板期（#300 主线整删）正是立门的最佳时机：新正文从第一天就受约束。
// 单一来源＝本文件 BANNED + 大深渊结局 SPEC §5.2。
//
// 扫描面＝主角 POV 叙事断言：
//   src/data/events/*.json 的 body / onEnter.text / options[].outcome.text
//   + options[].check.on{Success,Failure}.text（check-protagonist-voice 漏扫的面·一并盖上）。
// 豁免（都不是「叙述断言主角是人类」）：
//   - options[].label            —— 玩家自选的话（player voice·先入为主本就允许）。
//   - src/data/npcs/*.json       —— NPC 对话（可假设你是人类）。
//   - src/data/lore.json journal —— 署名角色的 found-document（如 Voss「我们人类」是他在说·非主角）。
// 例外放行：ALLOW 白名单（照 check-protagonist-voice 先例）——正文里引 NPC 原话等真破例逐条登记，
// 别改 BANNED 表。
//
// 在 scripts/regress.mjs 注册为 check-no-human-assertion（纯 node·与 check-protagonist-voice 同类）。
// 跑法： node scripts/check-no-human-assertion.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const EVENTS_DIR = resolve(ROOT, 'src/data/events');

// 禁词（单一来源）：叙述体/第二人称对主角断言人类身份或人类解剖。多字短语·锚定「你/我们」
// 指向主角，别用裸「人类」（世界观合法讨论人类 vs 古文明·会误伤）。
const BANNED = [
  '作为人类', '身为人类', '你是人类', '你也是人类', '你毕竟是人', '你我都是人',
  '我们人类', '你的人类', '人类的双手', '人类的血肉', '你人类的',
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
        `${where}\n      叙述断言主角为人类「${w}」——主角＝玩家投影·叙述不定义人类身份（NPC 对话可假设·破例登记 ALLOW）`,
      );
    }
  }
}

// 事件正文 / onEnter / 选项 outcome + check 成败文案（NOT label·NOT npcs·NOT journal）
for (const name of readdirSync(EVENTS_DIR).filter((n) => n.endsWith('.json')).sort()) {
  const file = join('src/data/events', name);
  const parsed = JSON.parse(readFileSync(resolve(ROOT, file), 'utf-8'));
  const events = Array.isArray(parsed) ? parsed : (parsed.events ?? []);
  for (const ev of events) {
    const base = `${file} → ${ev.id}`;
    scan(`${base} / body`, ev.body);
    scan(`${base} / onEnter`, ev.onEnter?.text);
    for (const opt of ev.options ?? []) {
      scan(`${base} / ${opt.id} outcome`, opt.outcome?.text);
      scan(`${base} / ${opt.id} check.success`, opt.check?.onSuccess?.text);
      scan(`${base} / ${opt.id} check.failure`, opt.check?.onFailure?.text);
    }
  }
}

if (violations.length) {
  console.error('✘ 叙述禁断言主角为人类：\n');
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    `\n共 ${violations.length} 处。单一来源＝scripts/check-no-human-assertion.mjs BANNED + 大深渊结局 SPEC §5.2；` +
      `\n破例登记 ALLOW（别改 BANNED）。`,
  );
  process.exit(1);
}

console.log(`✓ 叙述禁断言主角为人类：扫 ${scanned} 段叙述文本·零断言`);
process.exit(0);
