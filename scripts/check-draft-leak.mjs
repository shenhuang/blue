#!/usr/bin/env node
// 事件文案草稿标记泄漏门（CLAUDE.md「约定落成机制」）。
//
// 背景：[待过稿]＝作者「文案待过稿」草稿标记·本应只留在未上线内容。却漏进了 ch1 可达的事件选项 label
// （wreck_graveyard 三处·playtest 报告⑤：「找栅条边上松动的铆钉，硬掰一条缝（体力检定）[待过稿]」对玩家可见）。
// 本门把「事件 JSON 的玩家可见字段不得带草稿标记」焊成会红的检查。
//
// 扫描面：src/data/events/**/*.json 的玩家可见字段（label/text/body/title/blurb/description/name/prompt）。
// 豁免：_doc / _comment 开发注释字段（合法草稿登记处）；敌人库 src/data/enemies/ **不在**扫描面——
//       那批 [待过稿] 是未上线 boss/复杂敌人的有意草稿（boss_enemy_design）·上线时再清。
// 跑法：node scripts/check-draft-leak.mjs
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SCAN = resolve(ROOT, 'src/data/events');

const MARKERS = ['[待过稿]']; // 仅罩明确草稿标记·别误伤正文/_doc 里的「占位」等普通词
const PLAYER_FIELDS = new Set(['label', 'text', 'body', 'title', 'blurb', 'description', 'name', 'prompt']);

const files = [];
function walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name.endsWith('.json')) files.push(full);
  }
}
walk(SCAN);
files.sort();

const violations = [];
let scanned = 0;
for (const full of files) {
  scanned++;
  const rel = relative(ROOT, full);
  const lines = readFileSync(full, 'utf-8').split('\n');
  lines.forEach((line, i) => {
    if (!MARKERS.some((m) => line.includes(m))) return;
    const keyMatch = line.match(/^\s*"([^"]+)"\s*:/);
    const key = keyMatch ? keyMatch[1] : '';
    if (PLAYER_FIELDS.has(key)) {
      violations.push(
        `${rel}:${i + 1}\n      玩家可见字段「${key}」含草稿标记 [待过稿] → 上线前去掉（或把内容移出可达范围）`,
      );
    }
  });
}

if (violations.length) {
  console.error('✘ 文案草稿泄漏门：事件 JSON 的玩家可见字段出现 [待过稿]\n');
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    '\n修：去掉 [待过稿]（文案定稿）。开发草稿登记请用 _doc 字段；敌人库未上线草稿不在本门扫描面。',
  );
  process.exit(1);
}

console.log(`✓ 文案草稿泄漏门：扫 ${scanned} 个 src/data/events JSON·玩家可见字段零 [待过稿]`);
process.exit(0);
