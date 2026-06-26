#!/usr/bin/env node
// flag setter scope 门（机制化 quirk #160 / #161·incident CHANGELOG #184·2026-06-26）。
//
// 背景（两条写 flag 的通道·语义不同）：
//   · outcome.applyFlags     → engine/events.ts:223 → 有 run 时只进 `run.activeFlags`（**下潜结束即丢**）；
//                               无 run（港口 cutscene·depthRange[0,0]）时进 `profile.flags`（持久）。
//   · outcome.setProfileFlags → engine/events.ts:287 → 直接、跨 run/存档持久地写 `profile.flags`。
// 失效模式（incident #184）：一个**必须持久**的 flag（一次性门 / 剧情节拍 / 跨 run 消费的解锁）
//   却用 `applyFlags` 在**下潜中**置位 ⇒ run 结束 flag 蒸发、消费它的门**永远不成立**，静默无报错。
//   `flag.seen_first_uncanny` 就这么误用过 applyFlags（→ `tutorial.captain_revisit` 的 forbiddenFlags 永不触发·已修为 setProfileFlags）。
//
// 这道门把「持久该走 setProfileFlags」从散文焊成 regress 检查：**扫所有 `applyFlags`-置位的 flag，
//   若它同时被「需要跨下潜持久」的上下文消费 ⇒ 它本该用 setProfileFlags ⇒ 红。**
//
// 一个 applyFlags flag 算违例 iff 同时满足 (A) 与 (B)：
//   (A) 至少一个 applyFlags **setter 是下潜事件**（depthRange 上界 > 0 ⇒ 可能在 run≠null 时触发·applyFlags 被丢）。
//       — 所有 setter 都在水面（depthRange 上界 == 0）= 港口 cutscene，applyFlags 在那里写进 profile.flags（持久）⇒ 不算违例。
//         （实例：`flag.tutorial_complete` 由 tutorial.ending_log/ending_safe 在 depthRange[0,0] 的回港 cutscene 置位·
//          经 port.ts:64「run:null + portEvent」分支 ⇒ applyFlags 落 profile.flags·被 chart_pois.json 持久消费·**非 bug**。)
//   (B) 它被「需要 profile.flags 持久」的上下文消费：
//       (B1) 某 **weight > 0** 事件的 prereqFlags / forbiddenFlags / visibleIf{hasFlag,notHasFlag} 引用它。
//            —— buildEventPool（engine/zones.ts:134 先 `if (ev.weight<=0) continue`，再于 155–156 查 **opts.profileFlags**·
//               从不查 activeFlags）⇒ 进池事件的 prereq/forbidden 只认 profile.flags＝必须持久；池每潜重建＝跨下潜消费。
//            —— **weight<=0 事件的 prereq/forbidden 不进池**（由 triggerEventId/continueEvent 直连·同一下潜内 activeFlags 仍在·
//               evalCondition events.ts:63 也兼查 activeFlags）⇒ 不要求持久（合法 dive-scoped·quirk #161：
//               `flag.tutorial_chart_obtained` setter tutorial.wreck(depth25) → 同潜 prereq tutorial.deeper(**weight0**) ⇒ 不违例）。
//       (B2) flag 字符串出现在 **src/data/events/ 之外**的任一 data JSON
//            （chart_pois / chart_regions / lighthouse_upgrades / items.setsFlag / zones / depth_columns …）——
//            这些消费者一律读 profile.flags（chart.ts::flagsSatisfied / regions revealFlag / lighthouse requiresFlag）·必须持久。
//
// 怎么办（红了）：把那个 outcome 的 `applyFlags:[...]` 改成 `setProfileFlags:[...]`（若该 flag 确需持久·绝大多数门控/节拍/解锁都是）；
//   反之若它真只服务「同一次下潜内的后续事件」(同潜 triggerEventId 链·消费事件 weight<=0)·保持 applyFlags 并确保消费侧不进池即可。
//
// 与既有门同族（纯 node ESM·无第三方依赖·导出纯决策函数便于单测·参 check-event-poi / check-append-only-docs）。
// 在 scripts/regress.mjs 注册为 check-flag-setter 任务。
//   跑法： node scripts/check-flag-setter.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const EVENTS_DIR = resolve(ROOT, 'src/data/events');
const DATA_DIR = resolve(ROOT, 'src/data');

// ──────────────────────────────────────────────────────────────────────────
// 纯决策函数（无 IO·便于单测）。
//
// @param {Array} events   归一化的事件数组，每项：
//   { id, file, weight:number, depthMax:number,
//     applyFlags:string[],            // 该事件所有 outcome.applyFlags 的并集
//     prereqFlags:string[], forbiddenFlags:string[], visibleIfFlags:string[] }  // 消费侧引用
// @param {Map<string, Set<string>>} extFlagRefs
//   events/ 之外每个 data 文件里出现过的 flag 字符串：file → Set(flagString)。
//   （扫描端只把「与某 applyFlags flag 完全相等的字符串」收进来即可·见下方 IO 段。）
// @returns {{ violations: Array<{flag, kind, setters, consumers}> }}
//   kind: 'pooled-consumer'（B1）| 'external-consumer'（B2）。
//   一个 flag 两类都中只报一次（合并 consumers）。
// ──────────────────────────────────────────────────────────────────────────
export function decide(events, extFlagRefs) {
  // 1) 收集 applyFlags setter：flag → [{ev, file, depthMax}]
  const setters = new Map();
  for (const ev of events) {
    for (const fl of ev.applyFlags ?? []) {
      if (!setters.has(fl)) setters.set(fl, []);
      setters.get(fl).push({ ev: ev.id, file: ev.file, depthMax: ev.depthMax });
    }
  }

  // 2) (A) setter 过滤：至少一个 setter 是下潜事件（depthMax > 0）。
  //    全部 setter 都在水面（depthMax<=0）= 港口 cutscene·applyFlags 持久·豁免。
  const diveScoped = new Map(); // flag → setters[]（仅保留「有下潜 setter」的 flag）
  for (const [fl, ss] of setters) {
    if (ss.some((s) => s.depthMax > 0)) diveScoped.set(fl, ss);
  }

  // 3) (B) 持久消费者：
  //    (B1) weight>0 事件的 prereqFlags / forbiddenFlags / visibleIf{hasFlag}。
  //    (B2) events/ 之外的 data 文件引用该 flag。
  const violations = [];
  for (const [fl, ss] of diveScoped) {
    const consumers = [];
    for (const ev of events) {
      if (ev.weight <= 0) continue; // weight<=0 不进池·prereq/forbidden 不要求持久（合法 dive-scoped）
      if ((ev.prereqFlags ?? []).includes(fl)) consumers.push(`${ev.file}:${ev.id} prereqFlags (weight=${ev.weight})`);
      if ((ev.forbiddenFlags ?? []).includes(fl)) consumers.push(`${ev.file}:${ev.id} forbiddenFlags (weight=${ev.weight})`);
      if ((ev.visibleIfFlags ?? []).includes(fl)) consumers.push(`${ev.file}:${ev.id} visibleIf{hasFlag} (weight=${ev.weight})`);
    }
    const externalHits = [];
    for (const [file, flags] of extFlagRefs) {
      if (flags.has(fl)) externalHits.push(file);
    }
    if (consumers.length === 0 && externalHits.length === 0) continue;

    const kind = consumers.length > 0 ? 'pooled-consumer' : 'external-consumer';
    violations.push({
      flag: fl,
      kind,
      setters: ss.map((s) => `${s.file}:${s.ev} (depthMax=${s.depthMax})`),
      consumers: [...consumers, ...externalHits.map((f) => `${f} (persistent reader)`)],
    });
  }
  return { violations };
}

// ──────────────────────────────────────────────────────────────────────────
// IO / 解析（被 import 时不执行）。
// ──────────────────────────────────────────────────────────────────────────

/** 递归收集 outcome.applyFlags（事件里 outcome 可嵌在 options[].outcome / check.onSuccess|onFailure 等任意深度）。 */
function collectApplyFlags(node, out) {
  if (Array.isArray(node)) {
    for (const x of node) collectApplyFlags(x, out);
  } else if (node && typeof node === 'object') {
    if (Array.isArray(node.applyFlags)) for (const f of node.applyFlags) if (typeof f === 'string') out.add(f);
    for (const v of Object.values(node)) collectApplyFlags(v, out);
  }
}

/** 递归收集 visibleIf 里 hasFlag/notHasFlag 的 flag（option.visibleIf 可为单 Condition 或 and/or 组合·深扫兜底）。 */
function collectVisibleIfFlags(node, out) {
  if (Array.isArray(node)) {
    for (const x of node) collectVisibleIfFlags(x, out);
  } else if (node && typeof node === 'object') {
    if ((node.kind === 'hasFlag' || node.kind === 'notHasFlag') && typeof node.flag === 'string') out.add(node.flag);
    for (const v of Object.values(node)) collectVisibleIfFlags(v, out);
  }
}

/** 把一个事件文件归一化成 decide() 需要的事件数组。 */
function normalizeEventFile(fileRel, parsed) {
  const list = Array.isArray(parsed) ? parsed : (parsed.events ?? []);
  const out = [];
  for (const ev of list) {
    const applyFlags = new Set();
    collectApplyFlags(ev.options, applyFlags);
    const visibleIfFlags = new Set();
    collectVisibleIfFlags(ev.options, visibleIfFlags);
    const dr = Array.isArray(ev.depthRange) ? ev.depthRange : [0, 0];
    const depthMax = Math.max(Number(dr[0]) || 0, Number(dr[1]) || 0);
    out.push({
      id: ev.id ?? '(no-id)',
      file: fileRel,
      weight: Number(ev.weight ?? 0),
      depthMax,
      applyFlags: [...applyFlags],
      prereqFlags: Array.isArray(ev.prereqFlags) ? ev.prereqFlags : [],
      forbiddenFlags: Array.isArray(ev.forbiddenFlags) ? ev.forbiddenFlags : [],
      visibleIfFlags: [...visibleIfFlags],
    });
  }
  return out;
}

/** 递归收集一个 JSON 里出现过的所有字符串（用于在 events/ 之外的 data 文件里找 flag 引用）。 */
function collectAllStrings(node, out) {
  if (Array.isArray(node)) {
    for (const x of node) collectAllStrings(x, out);
  } else if (node && typeof node === 'object') {
    for (const v of Object.values(node)) collectAllStrings(v, out);
  } else if (typeof node === 'string') {
    out.add(node);
  }
}

function loadEvents() {
  const events = [];
  for (const name of readdirSync(EVENTS_DIR).filter((n) => n.endsWith('.json')).sort()) {
    const rel = join('src/data/events', name);
    const parsed = JSON.parse(readFileSync(resolve(ROOT, rel), 'utf-8'));
    events.push(...normalizeEventFile(rel, parsed));
  }
  return events;
}

/** events/ 之外的 data JSON：file(rel) → 该文件出现过的所有字符串集合（decide 只关心其中等于某 applyFlags flag 的）。 */
function loadExternalStringRefs() {
  const refs = new Map();
  for (const name of readdirSync(DATA_DIR).filter((n) => n.endsWith('.json')).sort()) {
    const rel = join('src/data', name);
    const parsed = JSON.parse(readFileSync(resolve(ROOT, rel), 'utf-8'));
    const strs = new Set();
    collectAllStrings(parsed, strs);
    refs.set(rel, strs);
  }
  return refs;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const events = loadEvents();
  const extRefs = loadExternalStringRefs();
  const { violations } = decide(events, extRefs);

  const applyCount = new Set(events.flatMap((e) => e.applyFlags)).size;

  if (violations.length) {
    console.error('✘ flag setter scope 门被破坏\n');
    for (const v of violations) {
      console.error(`  flag「${v.flag}」用 applyFlags 置位（下潜中只进 run.activeFlags·下潜结束即丢），`);
      console.error(`  但被「需要 profile.flags 持久」的上下文消费（${v.kind}）——本该用 setProfileFlags：`);
      for (const s of v.setters) console.error(`      setter   · ${s}`);
      for (const c of v.consumers) console.error(`      consumer · ${c}`);
      console.error('');
    }
    console.error(
      `共 ${violations.length} 个 flag。修：把对应 outcome 的 "applyFlags" 改成 "setProfileFlags"\n` +
        '（持久门控/剧情节拍/跨 run 解锁都属此类·quirk #160/#161·incident #184）。\n' +
        '若该 flag 真的只服务「同一次下潜内的后续事件」（同潜 triggerEventId 链·消费事件 weight<=0），\n' +
        '则保持 applyFlags·并确保消费事件不进 buildEventPool（weight<=0）——那是合法的 dive-scoped 用法。',
    );
    process.exit(1);
  }

  console.log(
    `✓ flag setter scope 门：扫 ${events.length} 事件、${applyCount} 个 applyFlags flag，` +
      '无「下潜中置位却被持久消费」的错配（applyFlags vs setProfileFlags·quirk #160/#161）。',
  );
  process.exit(0);
}
