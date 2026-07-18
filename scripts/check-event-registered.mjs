#!/usr/bin/env node
// 事件注册门（机制化 quirk #260：新事件 JSON 若未接进 engine/zones.ts 的 EVENT_DB，
// getEventById 会静默返回 undefined → 运行时呈现「[事件未找到]」，此前没有任何静态检查能拦住）。
//
// 背景（CHANGELOG #312·2026-07-17）：猩红暴君 boss 落点车道新增 src/data/events/scarlet.json，
// 一度漏了在 engine/zones.ts 里 import + 循环注册进 EVENT_DB 这一步——事件本身写得好好的、id 也
// 没拼错，但 EVENT_DB 里压根没有它，运行时 getEventById('story.scarlet_tyrant_encounter') 只会
// 拿到 undefined。这类 bug 没有任何 TS 类型错误（JSON import 类型独立于是否被消费）、没有 JSON
// 解析错误（check-data-schema.mjs 管不到「漏注册」，只管「解析失败/id 重复」）、也不是 poiId/DC
// 标注一类内容错（check-event-poi.mjs / check-event-dc.mjs 管不到）——纯粹是「作者忘了接线」的
// 静默死链，只有 playthrough 真的跑到那条事件时才会现形。本门把「JSON 里定义的事件 id ⊆ 已注册
// 进 EVENT_DB 的 id」焊成会红的检查（CLAUDE.md「能进 regress 的门优先」）。
//
// 判定方式（避免「id/EVENT_DB 字符串是否在 zones.ts 里出现过」这种会被注释/文档误伤的松散匹配——
// 本仓 src/data/events/qa_fixture.json 的 _doc 字段本身就写着「EVENT_DB」四个字，纯文本子串匹配
// 在这个仓库里已经现成地会假阳性；quirk #260 已明确点名这条门要「断言都在 zones.ts 装载入
// EVENT_DB」，故这里锚定**真实注册构造**而非字符串出现）：
//   1. 结构化扫 src/data/events/**/*.json（JSON.parse，不做文本匹配）拿到「JSON 里实际定义了
//      哪些事件 id」——ground truth。
//   2. 解析 engine/zones.ts 的真实注册结构：
//      a) 找 `import <local> from '<spec>.json'`，把落在 src/data/events/ 下的 specifier 解析
//         成绝对路径，建 local→file 映射（本仓目前只用 `@/` 别名 import；`@/*` → `src/*`，见
//         tsconfig.json paths）。
//      b) 找 `for (const e of (<local>.events ...)) EVENT_DB.set(e.id, e)` 这个具体的注册构造
//         （当前 zones.ts 里两行注册代码逐字符合此形状：loop 变量与 EVENT_DB.set 的两个参数用
//         同一个反向引用名字校验），收集真正被塞进 EVENT_DB 的 local 变量名集合。
//      c) 交叉引用 a+b：只有「被 import 且被这个构造塞进 EVENT_DB」的文件才算「已接线」——
//         对**那些文件**重新 JSON.parse 取 id（同样是结构化解析，不是文本匹配）。
//   3. 断言：步骤 1 的每个 id 都在步骤 2 的「已接线」集合里；缺了就打印「id + 来源文件」并退出 1。
//      方向只有 JSON→EVENT_DB 一路——不反查 EVENT_DB 有没有 JSON 之外混进来的东西（不是本门要
//      管的失败模式，也不存在：EVENT_DB 全仓只在 zones.ts 这两行 .set 过，见脚本验证）。
//
// 已知耦合（非 bug，是静态分析门的固有局限，已在此明示）：本门认的注册构造＝当前 zones.ts 唯一
// 使用的 for-of 单行范式。哪天注册逻辑换了形状（helper 函数 / 数组 spread 等），得同步更新下面
// REGISTER_RE，否则本门会对**全部**事件文件误报（因为一个都认不出「已接线」）——这跟改了函数
// 签名要同步改调用点是一回事，不是本门缺陷。为何不索性 `import.meta.glob` 自动装载 EVENT_DB
// （从根上让这类漏注册不可能发生）：引擎同码要跑 Vite（游戏）与 tsx（playthrough/脚本）两栈，
// `import.meta.glob` 只有 Vite 转换认得、tsx/node 不认，会炸测试栈——quirk #260 原文已排除此路。
//
// 范围之外（其它门已经管，不重复；CLAUDE.md「保持范围小」）：
//   - JSON 语法错误 / 事件 id 集合内部重复 → check-data-schema.mjs（src/data + scenarios 全量）。
//   - poiId 是否命中真实 POI → check-event-poi.mjs。
//   - check.{stat,dc} 与 label 标注是否一致 → check-event-dc.mjs。
//
// 在 scripts/regress.mjs 注册为 check-event-registered 任务（纯 node·无 esbuild 依赖·与
// check-event-poi / check-event-dc 同类·同扫 src/data/events）。
//
// 跑法： node scripts/check-event-registered.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const EVENTS_DIR = resolve(ROOT, 'src/data/events');
const ZONES_TS = resolve(ROOT, 'src/engine/zones.ts');

// ── 递归收集 src/data/events/**/*.json（现状扁平·预留未来分子目录，仿 check-boundaries.mjs::collectTs / check-data-schema.mjs::findJsonFiles）──
function collectJson(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // 目录不存在（假设性未来「内容全删」场景）→ 空集，不崩；quirk #260 原文「空集放行」
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...collectJson(full));
    else if (name.endsWith('.json')) out.push(full);
  }
  return out;
}

// ── 从已 parse 的 JSON 里取「事件对象」列表（形状防御：{events:[...]} 是现状——qa_fixture.json
// 与 scarlet.json 两个真实文件皆此形；另容忍顶层直接数组 / 无 events 包装的单事件裸对象，不猜
// 「id→事件」map 形态——仓库里从未出现过这种形状，猜了也验证不了）──
function eventsOf(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.events)) return parsed.events;
    if (typeof parsed.id === 'string') return [parsed];
  }
  return [];
}

// 结构化取某文件的事件 id 列表（parse 失败 → 空数组·语法错误自有 check-data-schema.mjs 拦，这里不重复报）。
function idsOfFile(absPath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absPath, 'utf-8'));
  } catch {
    return [];
  }
  return eventsOf(parsed)
    .map((e) => e && e.id)
    .filter((id) => typeof id === 'string');
}

// ── 步骤 1：ground truth —— JSON 里实际定义的事件 id ──
const eventFiles = collectJson(EVENTS_DIR).sort();
const definedIds = new Map(); // id → 相对路径（首次出现；重复 id 的检测归 check-data-schema.mjs 管）
for (const file of eventFiles) {
  const rel = relative(ROOT, file);
  for (const id of idsOfFile(file)) {
    if (!definedIds.has(id)) definedIds.set(id, rel);
  }
}

// 去块注释 /* ... */（非贪婪·跨行）与行注释 //...（到行尾）。不是通用 JS 解析器——够用范围＝本仓
// zones.ts 的实际写法（无正则字面量/无字符串内嵌 // 的反例，见文件头注全文均中文自然语言注释）。
// 必须做这一步的原因（红队实测发现）：若不去注释，把某行注册代码整行前缀 `//` 注释掉（最自然的
// "临时禁用一行代码"手法）不会让 REGISTER_RE 失去匹配——正则只看文本、不知道这行已经不执行了，
// 会假阴性放行一个实际上没注册的事件文件。先去注释再匹配，才能让"这行代码还在执行"与"这行只是
// 死文本"这两种情况在检测结果上产生正确的差异。
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

// ── 步骤 2a：zones.ts 里 import 的 *.json，落在 EVENTS_DIR 下的部分 → local 变量名 → 绝对路径 ──
const zonesText = stripComments(readFileSync(ZONES_TS, 'utf-8'));
const IMPORT_RE = /import\s+(\w+)\s+from\s*['"]([^'"]+\.json)['"]/g;

function resolveSpecifier(spec) {
  if (spec.startsWith('@/')) return resolve(ROOT, 'src', spec.slice(2)); // @/* → src/*（tsconfig.json paths）
  if (spec.startsWith('.')) return resolve(dirname(ZONES_TS), spec);
  return null; // 未知别名不解析（本仓事件类 import 目前只用 @/；保守：宁可漏判"已接线"也不误判）
}

const importedEventFiles = new Map(); // localName → 绝对路径（仅 EVENTS_DIR 下的 *.json）
{
  let m;
  while ((m = IMPORT_RE.exec(zonesText))) {
    const [, localName, spec] = m;
    const abs = resolveSpecifier(spec);
    if (abs && (abs === EVENTS_DIR || abs.startsWith(EVENTS_DIR + '/'))) {
      importedEventFiles.set(localName, abs);
    }
  }
}

// ── 步骤 2b：真正塞进 EVENT_DB 的注册构造 —— for (const X of (<local>.events ...)) EVENT_DB.set(X.id, X)
// 锚在这个具体形状（循环变量与 EVENT_DB.set 的两个参数用反向引用同一个名字校验），不是「EVENT_DB
// 这个词在文件里出现过」这种松散匹配——后者会被 qa_fixture.json 的 _doc 字段这类纯文本提及假阳性命中。
const REGISTER_RE =
  /for\s*\(\s*const\s+(\w+)\s+of\s*\(?\s*(\w+)\.events(?:\s+as\s+[^)]+)?\)?\s*\)\s*\{?\s*EVENT_DB\.set\(\s*\1\.id\s*,\s*\1\s*\)/g;

const registeredLocalNames = new Set();
{
  let m;
  while ((m = REGISTER_RE.exec(zonesText))) {
    registeredLocalNames.add(m[2]);
  }
}

// ── 步骤 2c：交叉引用 —— 「被 import 且被注册构造消费」的文件才算已接线；对这些文件重新结构化取 id ──
const registeredIds = new Set();
let wiredFileCount = 0;
for (const [localName, absPath] of importedEventFiles) {
  if (!registeredLocalNames.has(localName)) continue;
  wiredFileCount++;
  for (const id of idsOfFile(absPath)) registeredIds.add(id);
}

// ── 步骤 3：断言 JSON → EVENT_DB 单向覆盖（不查反向）──
const missing = [];
for (const [id, file] of definedIds) {
  if (!registeredIds.has(id)) missing.push({ id, file });
}

if (missing.length) {
  console.error(
    '✘ 事件注册门被破坏：以下事件在 src/data/events JSON 里定义，但未接进 engine/zones.ts 的 EVENT_DB\n',
  );
  for (const v of missing) {
    console.error(`  ${v.file} → "${v.id}"`);
  }
  console.error(
    `\n共 ${missing.length} 处。getEventById(id) 会返回 undefined，运行时静默呈现「[事件未找到]」（quirk #260）。` +
      '\n补法：在 engine/zones.ts 顶部 import 该 JSON 文件，再加一行注册（对齐现有两行写法）：' +
      '\n  for (const e of (<localName>.events as DiveEvent[])) EVENT_DB.set(e.id, e);\n',
  );
  process.exit(1);
}

console.log(
  `✓ 事件注册门：src/data/events 下 ${eventFiles.length} 个文件 · ${definedIds.size} 个事件 id，` +
    `全部经 ${wiredFileCount} 个已接线源文件注册进 engine/zones.ts 的 EVENT_DB。`,
);
process.exit(0);
