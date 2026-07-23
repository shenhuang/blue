#!/usr/bin/env node
// 侧壁 / 峡谷配置门（开阔水域 SPEC §6·#330）——`ZoneDef.openWaterWall`（types/dive.ts）是手填的裸对象
// （JSON 字面量），类型层的可选字段约束挡不住内容作者手滑：
//   - side 漏填 / 打错成不存在的值（比如多打一个空格、拼错大小写）；
//   - otherSide 该填时（side∈{left,right}）漏填，或不该填时（side='both'）却填了；
//   - material 填了非 'rock' 的值（当前 MVP 仅支持 rock）；
//   - 顺手加了个不认识的字段（拼写错的 key，比如 'otherside' 小写、'sides' 复数）——JSON 不报错，
//     只会让这个字段悄悄没被任何代码读到。
// 这些坏字符串不会让 TS 报错（都是 JSON 字面量，类型系统看不到具体运行时值），只会让
// computeWallEnvelope/wallInnerX（src/ui/openWaterRender.ts）读到一个不符合契约的 cfg——该函数只在
// TS 类型层面收窄、运行时没有二次校验，坏值会被当成合法配置悄悄走某个分支（例如 otherSide undefined
// 会被归一化成 'taper'，把本该报错的坏配置直接吞掉）。焊一道纯数据校验门，把「side/otherSide/material
// 合法组合」钉死成会在 regress 里变红的检查（CLAUDE.md「约定要落成机制」）。
//
// 不变量（同 types/dive.ts::ZoneDef.openWaterWall 字段注释）：
//   - side 必填 ∈ {'left','right','both'}；
//   - otherSide：side∈{'left','right'} 时必填 ∈ {'taper','midwater'}；side==='both' 时必须不填；
//   - material：若填，必须是 'rock'；
//   - 不认识的字段一律拉响。
// 没有 openWaterWall 字段的 zone 合法（跳过——缺省＝无墙，现状纯 floor/floorless，零行为变化）。
//
// 跑法：node scripts/check-openwater-wall.mjs　或在 npm run regress 里作 check-openwater-wall 任务。
// 退出码：全过=0，任一 zone 的 openWaterWall 不合法=1。纯 node·无依赖·进程隔离友好（同 check-zone-region）。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const VALID_SIDES = new Set(['left', 'right', 'both']);
const VALID_OTHER_SIDES = new Set(['taper', 'midwater']);
const VALID_KEYS = new Set(['side', 'otherSide', 'material']);

/**
 * 纯逻辑：找出 zones.json 里 openWaterWall 配置不合法的条目。data in / violations out，无 IO，便于单测。
 * @param {any} zonesJson zones.json 内容（顶层 { zones: [...] }）
 * @returns {Array<{ id: string, problem: string }>}
 */
export function findInvalidOpenWaterWalls(zonesJson) {
  const violations = [];
  for (const z of zonesJson?.zones ?? []) {
    const w = z?.openWaterWall;
    if (w === undefined) continue; // 不填＝合法（无墙）
    const id = z?.id ?? '(无 id)';

    if (typeof w !== 'object' || w === null || Array.isArray(w)) {
      violations.push({ id, problem: `openWaterWall 必须是对象，实际是 ${JSON.stringify(w)}` });
      continue; // 形状都不对，往下逐字段查只会产生一堆噪声次生错误
    }

    // 未知字段（拼写错的 key 会悄悄没人读——先拉响）
    for (const key of Object.keys(w)) {
      if (!VALID_KEYS.has(key)) {
        violations.push({ id, problem: `未知字段 "${key}"（合法字段：${[...VALID_KEYS].join('/')}）` });
      }
    }

    // side：必填 ∈ {'left','right','both'}
    if (w.side === undefined) {
      violations.push({ id, problem: 'side 必填但缺失' });
    } else if (!VALID_SIDES.has(w.side)) {
      violations.push({ id, problem: `side=${JSON.stringify(w.side)} 不合法（须 ∈ {left,right,both}）` });
    }

    // otherSide：side∈{left,right} 时必填 ∈ {taper,midwater}；side==='both' 时必须不填
    if (w.side === 'left' || w.side === 'right') {
      if (w.otherSide === undefined) {
        violations.push({ id, problem: `side=${JSON.stringify(w.side)} 时 otherSide 必填但缺失（须 ∈ {taper,midwater}）` });
      } else if (!VALID_OTHER_SIDES.has(w.otherSide)) {
        violations.push({ id, problem: `otherSide=${JSON.stringify(w.otherSide)} 不合法（须 ∈ {taper,midwater}）` });
      }
    } else if (w.side === 'both' && w.otherSide !== undefined) {
      violations.push({ id, problem: `side="both" 时 otherSide 必须不填，实际=${JSON.stringify(w.otherSide)}` });
    }

    // material：若填，必须是 'rock'
    if (w.material !== undefined && w.material !== 'rock') {
      violations.push({ id, problem: `material=${JSON.stringify(w.material)} 不合法（当前仅支持 'rock'）` });
    }
  }
  return violations;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const readJson = (p) => JSON.parse(readFileSync(p, 'utf-8'));
  const zonesJson = readJson(resolve(ROOT, 'src/data/zones.json'));

  const violations = findInvalidOpenWaterWalls(zonesJson);

  if (violations.length) {
    console.error(`✘ 侧壁配置门：${violations.length} 处 openWaterWall 配置不合法：\n`);
    for (const v of violations) {
      console.error(`  ${v.id}：${v.problem}`);
    }
    console.error(
      '\n改法：side 必填 ∈ {left,right,both}；side∈{left,right} 时 otherSide 必填 ∈ {taper,midwater}，' +
        'side="both" 时 otherSide 必须不填；material 若填只能是 "rock"；别的字段一律不认' +
        '（详见 types/dive.ts::ZoneDef.openWaterWall 字段注释）。',
    );
    process.exit(1);
  }

  console.log('✓ 侧壁配置门：zones.json 里已填的 openWaterWall 均合法（side/otherSide/material 组合正确·无未知字段）。');
  process.exit(0);
}
