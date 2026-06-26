#!/usr/bin/env node
// 月相窗门「无软锁 + schema」门（月相潮汐 SPEC §7·Ch.1 版·2026-06-26）。
//
// 把两条月相约定焊成 regress 门（CLAUDE.md 顶部原则：能变成会失败的检查就那样做）：
//
//   ① schema：任何 POI/模板的 lunarWindow 只能引用合法 LunarPhase（new|waxing|full|waning）、非空数组；
//      lunarOffWindow 若设只能是 'hidden'|'dim'。错相位名 = 月相永不命中 = 该点永不可达（静默软锁）。
//
//   ② Ch.1 无软锁：**anchor（persistent 主线点）一律不带 lunarWindow**——主线在任何相位都在
//      （SPEC §7「关键路径无月相窗」）。月相 gate 对 story/persistent 本就豁免（chart.ts::lunarExempt），
//      给 anchor 写窗是无效又误导的；机会成本/相位浮现只挂 roamingTemplates（opportunity points）。
//      Ch.2 祭祀（lunarRitual opt-in）再放开此门、换跨相位可达性检查（SPEC §7「Ch.2+ 升级门」）。
//
// 跑法：node scripts/check-lunar-reach.mjs  或在 npm run regress 里作 check-lunar-reach 任务。
// 退出码：全过=0，任一违规=1。纯 node·无依赖·进程隔离友好。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const VALID_PHASES = ['new', 'waxing', 'full', 'waning'];
const VALID_OFF = ['hidden', 'dim'];

/**
 * 纯逻辑：扫一份 chart_pois 文件树，收集 lunarWindow / lunarOffWindow 违规。无 IO·便于单测。
 * @returns {{schema:string[], anchorWindow:string[]}}
 */
export function findLunarViolations(file) {
  const schema = [];
  const anchorWindow = [];
  const checkWindow = (poi, where) => {
    if (poi.lunarWindow !== undefined) {
      const w = poi.lunarWindow;
      if (!Array.isArray(w) || w.length === 0) {
        schema.push(`${where}「${poi.id ?? poi.templateId}」lunarWindow 必须是非空相位数组`);
      } else {
        for (const ph of w) {
          if (!VALID_PHASES.includes(ph)) {
            schema.push(`${where}「${poi.id ?? poi.templateId}」lunarWindow 含非法相位「${ph}」（合法：${VALID_PHASES.join('/')}）`);
          }
        }
      }
    }
    if (poi.lunarOffWindow !== undefined && !VALID_OFF.includes(poi.lunarOffWindow)) {
      schema.push(`${where}「${poi.id ?? poi.templateId}」lunarOffWindow 非法值「${poi.lunarOffWindow}」（合法：${VALID_OFF.join('/')}）`);
    }
  };

  for (const key of Object.keys(file)) {
    const seg = file[key];
    if (typeof seg === 'string' || key.startsWith('_')) continue;
    for (const a of seg.anchors ?? []) {
      checkWindow(a, `${key}.anchors`);
      // Ch.1 无软锁：anchor 不得带月相窗（主线相位无关）。
      if (Array.isArray(a.lunarWindow) && a.lunarWindow.length > 0) {
        anchorWindow.push(`${key}.anchors「${a.id}」带 lunarWindow——主线 anchor 须相位无关（机会窗只挂 roamingTemplates）`);
      }
    }
    for (const t of seg.roamingTemplates ?? []) checkWindow(t, `${key}.roamingTemplates`);
  }
  return { schema, anchorWindow };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const file = JSON.parse(readFileSync(resolve(ROOT, 'src/data/chart_pois.json'), 'utf-8'));
  const { schema, anchorWindow } = findLunarViolations(file);

  let failed = false;
  if (schema.length) {
    failed = true;
    console.error(`✘ 月相 schema 违规 ${schema.length} 处：\n`);
    for (const s of schema) console.error(`  ${s}`);
    console.error('');
  }
  if (anchorWindow.length) {
    failed = true;
    console.error(`✘ Ch.1 无软锁违规 ${anchorWindow.length} 处（anchor 带月相窗）：\n`);
    for (const s of anchorWindow) console.error(`  ${s}`);
    console.error('\n  主线 anchor 任何相位都该在；机会点的相位浮现/消失挂 roamingTemplates.lunarWindow。');
  }
  if (failed) process.exit(1);

  console.log('✓ 月相门：lunarWindow/lunarOffWindow 合法 + Ch.1 主线 anchor 无月相窗（无软锁）。');
  process.exit(0);
}
