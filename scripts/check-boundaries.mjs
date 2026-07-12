#!/usr/bin/env node
// 架构边界检查（规则一至九·规则四已随负伤系统整套下线停用，命中任一活跃规则即打印 file:line 并退出 1）：
//
// 规则一：engine ↛ ui —— 引擎层不得依赖 UI 层 / React。
//   扫 src/engine/**/*.ts(x) 的模块说明符：
//   - 从 React 导入：'react' / 'react-dom' / 'react/...' / 'react-dom/...'
//   - 从 UI 层导入：路径含 ui/ 段（'../ui/x' / '@/ui' / '@/ui/x' / 'ui/x'）
//
// 规则二：src/ui 禁 phase 字面量 —— phase 构造权收归 engine（CHANGELOG #107·品味评审候选②）。
//   扫 src/ui/**/*.ts(x) + src/App.tsx，命中 `phase: {` / `subPhase: {`（对象字面量
//   构造）即违例。UI 切 phase 一律走 engine/transitions.ts 的具名转移（toPort /
//   beginAscent / toShop / toChart / toDiveEvent / toGameOver …）或别的引擎 reducer。
//   读 phase（state.phase.kind 等）不受限——只禁构造。
//
// 规则三：styles.css 滚动容器白名单 —— 内容滚动统一走 PanelShell（quirk #112）。
//   `overflow(-y): auto|scroll` 只许出现在 .panel-shell-body / .changelog-body；
//   内容型视图要内部滚动＝用 ui/PanelShell 包，别自己开滚动容器。
//
// 规则四：已停用（战斗系统改版 2026-07-10·#290）——run.injuries / injuries.ts / modifiers.ts 随负伤
//   系统整套下线一起删，字段不再存在，本规则无对象可查。编号保留占位（只增不重排），别复用给别的规则；
//   函数体见下方「规则四已删除」桩注释，此处头部同步收窄，避免头/体各说各话误导读者。
//
// 规则五：game ↛ dev —— 游戏入口/UI（App.tsx + src/ui 下非 dev 文件）不得 import dev 工具
//   （src/ui/dev/** + MapEditor/StoryEditor/EditorApp/EditorShell）。dev 工具只经 ?editor 工作台
//   （EditorApp·main.tsx 不扫）入口；把「dev 不进游戏主包/不揭整张图」从散文升成机制（dev工作台 SPEC §6）。
//
// 规则六：nitrogen 债务写口收窄（氮气单写口·quirk #128·仿规则四 run.injuries）。
//   氮气债（深度/时间）的计算单点在 engine/nitrogen.ts（stepNitrogen）+ ascent.ts（上升减压）。
//   nitrogen 到处被「读」（computeRequiredStops 等·合法）→ 只查「写」：就地变异 x.nitrogen=/+=/-=/++/--，
//   或 stat 构造里内联 +/- 债务算术 nitrogen:<…±…>。白名单（nitrogen/ascent/events/state）外的
//   src/engine 命中即违例（当前 0 处：step 走 stepNitrogen()、clamp 走 Math、fixture 只写 0）。
//
// 规则七：profile.trust 触碰面收口（通用信任系统·藏宝贸易与信任系统 SPEC §3.3·仿规则四 run.injuries）。
//   信任数值单源 profile.trust（npcId→数）的读写派生只许 engine/trust.ts（trustValue/trustTier/gainTrust/loseTrust）
//   + state.ts（createInitialProfile 种 + hydrateGameState 补）。别处引擎文件散读散写 profile.trust 即违例——
//   门控走 events.ts::evalCondition 的 npcTrustTier（内部调 trustTier·不碰 profile.trust）。当前 0 违例。
//
// 规则八：敌人 JSON 禁 evasion/hitBonus（惰性数据轴清理·quirk #243 续·#291）。
//   命中率系统整套删后（战斗系统改版「必中」·#290），`evasion`/`hitBonus` 在代码里已零消费点，
//   继续留在 `src/data/enemies/*.json` 里会让编数据的人误以为改它有效（调 evasion 4→9 静默无效）。
//   扫全部敌人 JSON 文件，命中键名 `"evasion"` / `"hitBonus"` 即违例——机制化住「命中制若重开，
//   得先在这里松绑」这条约定（CLAUDE.md「能进 regress 的门优先」）。
//
// 规则九：敌人 JSON 的词条字段须 ∈ src/data/affixes.json 登记的 id 集，且组内不重复
//   （敌人词条系统试点·2026-07-12·单词条随机化修正续）。词条元数据单一源＝affixes.json；效果单一源＝
//   engine/affixes.ts + engine/combat.ts 的接线点。扫全部敌人 JSON 文件的三处词条字段：
//   - `.enemies[].affixes`（固定集，仍支持）
//   - `.enemies[].randomAffixes.pool`（随机抽取池·缺省=全部词条）+ `.count`（须落在 1..池大小 之间）
//   - `.combatEncounters[].party.members[].affixesOverride`（encounter 钉死集，测试用）
//   命中非法 id（typo/未登记）、组内重复 id、或 count 越界即违例——防止数据侧写了个不存在的词条
//   （静默无效：hasAffix 永远查不到）、同一敌人重复声明同一词条（无意义·堆叠语义未定义）、或
//   count 越界（0 抽不出任何词条 / 越过池大小的部分抽不到，静默截断误导编数据的人）。
//
// 把此前靠散文（CLAUDE.md / 评审记忆）维持的解耦约定做成会在 `npm run regress`
// 里失败的门。现状 0 违例 → 直接绿；以后谁越界，这个门会红——不再靠下一个
// agent 读懂散文来遵守。
//
// 在 scripts/regress.mjs 注册为 check-boundaries 任务（与 verify-tutorial 同类·纯 node）。
//
// 跑法： node scripts/check-boundaries.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ENGINE_DIR = resolve(ROOT, 'src/engine');

// 递归收集 .ts/.tsx（engine 目前是扁平目录，但按 **/*.ts 防未来加子目录）
function collectTs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...collectTs(full));
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

// 抽出模块说明符：import/export ... from '...'（含多行 import·锚在 from）
// + 动态 import('...') + require('...')。扫全文（非逐行）以兼容多行 import。
const SPEC_RE =
  /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

// 违规判定（精确·避免把 'build'〔含 ui 子串〕、'@/ui-utils' 等误判）
const REACT_RE = /^react(-dom)?(\/|$)/; // react · react-dom · react/jsx-runtime · react-dom/server
const UI_RE = /(^|\/)ui(\/|$)/;          // ../ui/x · @/ui · @/ui/x · ui/x（ui 必须是完整路径段）

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

// ── 规则一：engine ↛ ui ──────────────────────────────────────
const engineFiles = collectTs(ENGINE_DIR).sort();
const importViolations = [];

for (const file of engineFiles) {
  const text = readFileSync(file, 'utf-8');
  let m;
  SPEC_RE.lastIndex = 0;
  while ((m = SPEC_RE.exec(text))) {
    const spec = m[1] || m[2] || m[3];
    if (!spec) continue;
    let why = null;
    if (REACT_RE.test(spec)) why = 'React';
    else if (UI_RE.test(spec)) why = 'UI 层';
    if (why) {
      importViolations.push({ file: relative(ROOT, file), line: lineOf(text, m.index), spec, why });
    }
  }
}

// ── 规则二：src/ui 禁 phase 字面量（构造收归 engine/transitions）──
// 只匹配对象字面量属性构造 `phase: {` / `subPhase: {`；读取（state.phase.kind）
// 与类型注解（phase: GamePhase）都不含 `: {`，不会误判。
const PHASE_LITERAL_RE = /\b(?:phase|subPhase)\s*:\s*\{/g;
const UI_DIR = resolve(ROOT, 'src/ui');
const uiFiles = [...collectTs(UI_DIR), resolve(ROOT, 'src/App.tsx')].sort();
const phaseViolations = [];

for (const file of uiFiles) {
  const text = readFileSync(file, 'utf-8');
  let m;
  PHASE_LITERAL_RE.lastIndex = 0;
  while ((m = PHASE_LITERAL_RE.exec(text))) {
    phaseViolations.push({ file: relative(ROOT, file), line: lineOf(text, m.index) });
  }
}

// ── 规则三：滚动容器白名单 —— 内容滚动统一走 PanelShell（quirk #112）──
// src/styles.css 里 `overflow(-y): auto|scroll` 只允许出现在白名单类上：
//   .panel-shell-body（内容型界面统一壳的滚动体·ui/PanelShell.tsx）
//   .changelog-body （更新日志弹窗·壳之前的既有先例）
//   .pickup-grid （获得物品弹窗的物品格容器·2026-06-25）：与 .changelog-body 同类——独立模态弹窗，
//     非内容型主视图，不归 PanelShell 管；头部「获得物品」+ 底部提示固定、中间物品格滚（极端多件兜底）。
//   .dive-header.has-dive-panel .dive-panel（下潜 HUD 移动端全屏面板·物品栏/装备 SPEC §6）：
//     状态条 + 传感器/面板开关由 .dive-header(flex 列) 钉顶、只面板内容滚——已满足「头部固定/内容滚」之意。
//   .combat-log（战斗日志固定高度滚动条·2026-07-02）：不是 PanelShell 管的内容型主视图——
//     它是 .combat-main 里一段**恒定 112px** 的小型日志窗（跟 .pickup-grid 同类：独立小型滚动体，
//     没有「头部状态/关闭出口」这层结构，PanelShell 的题头+✕不适用）；固定高度本身就是它要解决的问题
//     （日志随战斗变长不再撑高外层排版），不是绕开壳、是壳管不到的形状。
// 其余选择器一律违例——内容型视图要内部滚动＝用 PanelShell 包（头部状态固定/内容滚/
// 底部出口三段），别自己开滚动容器；散开自写迟早回到「金币和返回被滚走」。
// 范围只限 src/styles.css（玩家界面）；src/ui/dev/*.css 是 dev 工具自留地，不管。
// 解析假设：styles.css 是扁平 CSS——声明上方最近的 `selector {` 行即其归属；
// @media 块内仍有选择器行，不会把声明算到 @media 头上。注释行（行内含 `*`）跳过。
const SCROLL_WHITELIST = ['.panel-shell-body', '.changelog-body', '.pickup-grid', '.dive-header.has-dive-panel .dive-panel', '.combat-log'];
const SCROLL_DECL_RE = /\boverflow(?:-y)?\s*:\s*(?:auto|scroll)\b/;
const cssPath = resolve(ROOT, 'src/styles.css');
const scrollViolations = [];
{
  const lines = readFileSync(cssPath, 'utf-8').split('\n');
  let selector = '(顶层)';
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^\s*([^{}]+?)\s*\{\s*$/);
    if (open && !open[1].trim().startsWith('@')) selector = open[1].trim();
    if (
      SCROLL_DECL_RE.test(lines[i]) &&
      !lines[i].includes('*') &&
      !SCROLL_WHITELIST.some((w) => selector.includes(w))
    ) {
      scrollViolations.push({ line: i + 1, selector });
    }
  }
}

// 规则四（run.injuries 触碰面收口）已随负伤系统整套下线删除（战斗系统改版 2026-07-10）：run.injuries 字段不再存在。

// ── 规则五：game ↛ dev —— 游戏入口/UI 不得 import dev 工具（dev 工作台解耦·dev工作台 SPEC §6）──
// dev 工具＝src/ui/dev/** + MapEditor/StoryEditor/EditorApp/EditorShell；只有 main.tsx（不扫）与
// dev 工具彼此可 import。扫 App.tsx + src/ui 下非 dev 文件，import 到 dev 工具即违例。
// engine→dev 已被规则一（engine↛ui·dev 在 ui 下）覆盖，这里专扫 game UI + App。
const DEV_DIR = resolve(ROOT, 'src/ui/dev');
const DEV_ROOT_FILES = new Set([
  resolve(ROOT, 'src/ui/MapEditor.tsx'),
  resolve(ROOT, 'src/ui/StoryEditor.tsx'),
  resolve(ROOT, 'src/ui/EditorApp.tsx'),
  resolve(ROOT, 'src/ui/EditorShell.tsx'),
]);
const isDevFile = (abs) => abs === DEV_DIR || abs.startsWith(DEV_DIR + '/') || DEV_ROOT_FILES.has(abs);
// 模块说明符指向 dev 工具：含 dev/ 段（ui/dev/x · ./dev/x · @/ui/dev/x；devMode 不含 dev/ 不命中），
// 或 basename 是编辑器根（./MapEditor · @/ui/StoryEditor …）。
const DEV_DIR_SPEC_RE = /(^|\/)dev\//;
const DEV_ROOT_SPEC_RE = /(^|\/)(MapEditor|StoryEditor|EditorApp|EditorShell)$/;
const gameFiles = [...collectTs(UI_DIR), resolve(ROOT, 'src/App.tsx')]
  .filter((f) => !isDevFile(f))
  .sort();
const devImportViolations = [];
for (const file of gameFiles) {
  const text = readFileSync(file, 'utf-8');
  let m;
  SPEC_RE.lastIndex = 0;
  while ((m = SPEC_RE.exec(text))) {
    const spec = m[1] || m[2] || m[3];
    if (!spec) continue;
    if (DEV_DIR_SPEC_RE.test(spec) || DEV_ROOT_SPEC_RE.test(spec)) {
      devImportViolations.push({ file: relative(ROOT, file), line: lineOf(text, m.index), spec });
    }
  }
}

// ── 规则六：nitrogen 债务写口收窄（氮气单写口·quirk #128·仿规则四）──
// 只查「写」（nitrogen 到处被读·合法）：就地变异 x.nitrogen=/+=/-=/++/-- 或 stat 构造内联 +/- 债务算术。
// `=(?!=)` 排除 == / === 比较；构造分支要求 `nitrogen:` 后同行出现 +/-（step 用 stepNitrogen()、clamp 用 Math·均不含 +/-）。
const NITROGEN_MUT_RE = /\bnitrogen\s*(?:\+\+|--|[-+*/]?=(?!=))|\bnitrogen\s*:\s*[^,}\n]*[-+][^,}\n]*/;
const NITROGEN_WHITELIST = new Set([
  'src/engine/nitrogen.ts', // 氮气债数学单点（step）
  'src/engine/ascent.ts',   // 上升减压（nitrogen 债的另一正当写者）
  'src/engine/events.ts',   // 每回合 step 构造（走 stepNitrogen）
  'src/engine/state.ts',    // createNewRun 种子 + hydrate clamp
]);
const nitrogenViolations = [];
for (const file of engineFiles) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (NITROGEN_WHITELIST.has(rel)) continue;
  const lines = readFileSync(file, 'utf-8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const code = lines[i].replace(/\/\/.*$/, ''); // 去行尾注释
    const t = code.trimStart();
    if (t.startsWith('*') || t.startsWith('/*')) continue; // 块注释行
    if (NITROGEN_MUT_RE.test(code)) nitrogenViolations.push({ file: rel, line: i + 1 });
  }
}

// ── 规则七：profile.trust 触碰面收口（通用信任系统·SPEC §3.3·仿规则四）──
// 匹配 profile.trust / profile!.trust / profile?.trust（含 state.profile.trust 等前缀·\b 在点号后照样断词）。
const TRUST_RE = /\bprofile!?\??\.trust\b/g;
const TRUST_WHITELIST = new Set([
  'src/engine/trust.ts', // 读写派生唯一者（trustValue/trustTier/gainTrust/loseTrust）
  'src/engine/state.ts', // createInitialProfile 种子 + hydrateGameState 单点补
]);
const trustViolations = [];
for (const file of engineFiles) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (TRUST_WHITELIST.has(rel)) continue;
  const text = readFileSync(file, 'utf-8');
  let m;
  TRUST_RE.lastIndex = 0;
  while ((m = TRUST_RE.exec(text))) {
    trustViolations.push({ file: rel, line: lineOf(text, m.index) });
  }
}

// ── 规则八：敌人 JSON 禁 evasion/hitBonus（惰性数据轴清理·quirk #243 续·#291）──
// 命中率系统整套删后两个字段零消费点·继续留在数据里会让人误以为改它有效。扫键名，不看值。
const ENEMIES_DIR = resolve(ROOT, 'src/data/enemies');
const DEAD_KEY_RE = /"(evasion|hitBonus)"\s*:/g;
const deadKeyViolations = [];
for (const name of readdirSync(ENEMIES_DIR)) {
  if (!name.endsWith('.json')) continue;
  const file = join(ENEMIES_DIR, name);
  const text = readFileSync(file, 'utf-8');
  let m;
  DEAD_KEY_RE.lastIndex = 0;
  while ((m = DEAD_KEY_RE.exec(text))) {
    deadKeyViolations.push({ file: relative(ROOT, file), line: lineOf(text, m.index), key: m[1] });
  }
}

// ── 规则九：敌人 JSON 词条字段须 ∈ affixes.json 登记 id 集·组内不重复（敌人词条系统试点·2026-07-12·单词条随机化修正续）──
const AFFIXES_FILE = resolve(ROOT, 'src/data/affixes.json');
const VALID_AFFIX_IDS = new Set(
  JSON.parse(readFileSync(AFFIXES_FILE, 'utf-8')).map((a) => a.id),
);
const affixViolations = [];
/** 检查一个 id 数组（fixed affixes / randomAffixes.pool / affixesOverride 共用）：非法 id + 组内重复。 */
function checkAffixIdArray(ids, file, enemyId, field, violations) {
  const seen = new Set();
  for (const id of ids) {
    if (!VALID_AFFIX_IDS.has(id)) {
      violations.push({ file, enemyId, kind: 'unknown', id, field });
    } else if (seen.has(id)) {
      violations.push({ file, enemyId, kind: 'dup', id, field });
    }
    seen.add(id);
  }
}
for (const name of readdirSync(ENEMIES_DIR)) {
  if (!name.endsWith('.json')) continue;
  const file = join(ENEMIES_DIR, name);
  const rel = relative(ROOT, file);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    continue; // JSON 解析失败自有别的门（check-enemy-refs）拦，这里不重复报
  }
  for (const e of parsed.enemies ?? []) {
    if (Array.isArray(e.affixes)) {
      checkAffixIdArray(e.affixes, rel, e.id, 'affixes', affixViolations);
    }
    if (e.randomAffixes) {
      const pool = Array.isArray(e.randomAffixes.pool) ? e.randomAffixes.pool : undefined;
      if (pool) checkAffixIdArray(pool, rel, e.id, 'randomAffixes.pool', affixViolations);
      const poolSize = pool ? pool.length : VALID_AFFIX_IDS.size;
      const count = e.randomAffixes.count;
      if (typeof count !== 'number' || count < 1 || count > poolSize) {
        affixViolations.push({ file: rel, enemyId: e.id, kind: 'badCount', id: String(count), field: 'randomAffixes.count' });
      }
    }
  }
  for (const enc of parsed.combatEncounters ?? []) {
    for (const m of enc.party?.members ?? []) {
      if (Array.isArray(m.affixesOverride)) {
        checkAffixIdArray(m.affixesOverride, rel, `${enc.id}:${m.defId ?? '<ref>'}`, 'affixesOverride', affixViolations);
      }
    }
  }
}

let failed = false;

if (importViolations.length) {
  failed = true;
  console.error('✘ engine ↛ ui 边界违例：引擎层（src/engine）不得依赖 UI / React\n');
  for (const v of importViolations) {
    console.error(`  ${v.file}:${v.line}  从 ${v.why} 导入 '${v.spec}'`);
  }
  console.error(
    `\n共 ${importViolations.length} 处。引擎是纯逻辑层，依赖只能单向：ui → engine。` +
      `\n把表现层依赖（React / src/ui/*）留在 ui/ 内；引擎只暴露纯数据与函数。\n`,
  );
}

if (phaseViolations.length) {
  failed = true;
  console.error('✘ src/ui 手搓 phase 字面量违例：phase 构造权在 engine\n');
  for (const v of phaseViolations) {
    console.error(`  ${v.file}:${v.line}  对象字面量构造 phase/subPhase`);
  }
  console.error(
    `\n共 ${phaseViolations.length} 处。UI 切 phase 走 engine/transitions.ts 的具名转移` +
      `\n（toPort / beginAscent / toShop / toChart / toDiveEvent / toGameOver …）；` +
      `\n缺哪个语义就在那里加一个，别在 UI 拼 phase 形状。`,
  );
}

if (scrollViolations.length) {
  failed = true;
  console.error('✘ styles.css 滚动容器白名单违例：内容滚动统一走 PanelShell（quirk #112）\n');
  for (const v of scrollViolations) {
    console.error(`  src/styles.css:${v.line}  「${v.selector}」声明了 overflow(-y): auto|scroll`);
  }
  console.error(
    `\n共 ${scrollViolations.length} 处。内容型视图要内部滚动＝用 ui/PanelShell 包` +
      `\n（头部状态固定 / 内容滚 / 底部出口通栏），别自己开滚动容器；` +
      `\n确属新的正当滚动体，再把类名加进 check-boundaries.mjs 的 SCROLL_WHITELIST。\n`,
  );
}


if (devImportViolations.length) {
  failed = true;
  console.error('✘ game ↛ dev 边界违例：游戏入口/UI 不得 import dev 工具（dev 工作台与游戏解耦）\n');
  for (const v of devImportViolations) {
    console.error(`  ${v.file}:${v.line}  import dev 工具 '${v.spec}'`);
  }
  console.error(
    `\n共 ${devImportViolations.length} 处。dev 面板/编辑器只经 ?editor 工作台（EditorApp·main.tsx）入口；` +
      `\n游戏侧别 import src/ui/dev/* 或 MapEditor/StoryEditor/EditorApp/EditorShell——` +
      `\n保 dev 代码不进游戏主包、地图调试器不揭整张图（dev工作台 SPEC §6）。\n`,
  );
}

if (nitrogenViolations.length) {
  failed = true;
  console.error('✘ nitrogen 债务写口违例：氮气债计算单点在 engine/nitrogen.ts（+ ascent 减压）\n');
  for (const v of nitrogenViolations) {
    console.error(`  ${v.file}:${v.line}  直接写 / 内联算 nitrogen 债务`);
  }
  console.error(
    `\n共 ${nitrogenViolations.length} 处。氮气债（步进/减压）走 engine/nitrogen.ts 的 stepNitrogen` +
      `\n（+ ascent.ts 上升减压）；别在别处就地变异 nitrogen 或散写 +/- 债务算术（quirk #128·仿 run.injuries 规则四）。\n`,
  );
}

if (trustViolations.length) {
  failed = true;
  console.error('✘ profile.trust 触碰面违例：信任数值读写派生单点在 engine/trust.ts（通用信任系统 SPEC §3.3）\n');
  for (const v of trustViolations) {
    console.error(`  ${v.file}:${v.line}  直接触碰 profile.trust`);
  }
  console.error(
    `\n共 ${trustViolations.length} 处。引擎内信任一律走 engine/trust.ts（trustValue/trustTier 读派生·gainTrust/loseTrust 写）；` +
      `\n门控走 events.ts::evalCondition 的 npcTrustTier（内部调 trustTier）。别散读散写 profile.trust（仿 run.injuries 规则四）。\n`,
  );
}

if (deadKeyViolations.length) {
  failed = true;
  console.error('✘ 敌人 JSON 惰性数据违例：evasion/hitBonus 已零消费点（命中率系统整套删·quirk #243）\n');
  for (const v of deadKeyViolations) {
    console.error(`  ${v.file}:${v.line}  "${v.key}" 键（读它的代码不存在）`);
  }
  console.error(
    `\n共 ${deadKeyViolations.length} 处。命中判定已删（战斗系统改版「必中」·#290/#291），evasion/hitBonus 别再写回` +
      `\n敌人 JSON——改它静默无效。真要重开命中制，先在这里松绑本规则，再决定数据形状。\n`,
  );
}

if (affixViolations.length) {
  failed = true;
  console.error('✘ 敌人 JSON 词条违例：affixes/randomAffixes/affixesOverride 须 ∈ src/data/affixes.json 登记 id 集·组内不重复·count 合法\n');
  for (const v of affixViolations) {
    if (v.kind === 'unknown') {
      console.error(`  ${v.file}  ${v.enemyId}.${v.field} 含未登记的词条 id "${v.id}"`);
    } else if (v.kind === 'dup') {
      console.error(`  ${v.file}  ${v.enemyId}.${v.field} 重复声明词条 id "${v.id}"`);
    } else {
      console.error(`  ${v.file}  ${v.enemyId}.${v.field} 越界（须 1..池大小）：值 "${v.id}"`);
    }
  }
  console.error(
    `\n共 ${affixViolations.length} 处。词条 id 单一源 src/data/affixes.json（+ engine/affixes.ts 的` +
      `\nHANDLED_AFFIX_IDS/AffixId 联合 + combat.ts 效果接线）；改 id 或补登记，别让敌人挂一个查不到的词条；` +
      `\nrandomAffixes.count 须落在 1..(pool?.length ?? 全部词条数) 之间，别写 0 或超过池大小。\n`,
  );
}

if (failed) process.exit(1);

console.log(
  `✓ 边界干净：engine ↛ ui（src/engine ${engineFiles.length} 文件·0 违例）` +
    `；src/ui 无 phase 字面量（src/ui+App ${uiFiles.length} 文件·0 违例）` +
    `；styles.css 滚动容器全在白名单（${SCROLL_WHITELIST.join(' / ')}）` +
    `；game ↛ dev（游戏侧 ${gameFiles.length} 文件不 import dev 工具）` +
    `；nitrogen 债务写口收窄（engine 内仅 nitrogen/ascent/events/state 写）` +
    `；profile.trust 触碰面收口（engine 内仅 trust/state）` +
    `；敌人 JSON 无 evasion/hitBonus 惰性键` +
    `；敌人 JSON 词条字段合法且不重复（affixes/randomAffixes/affixesOverride·登记 id ${VALID_AFFIX_IDS.size} 个）`,
);
process.exit(0);
