#!/usr/bin/env node
// 敌人库 SPEC（docs/spec/深海回响_敌人库_SPEC.md）支柱三：目录自动加载。
//
// 从 src/data/enemies/*.json 自动生成一个**静态 import** 的注册表文件，取代 combat.ts 里
// 一只一只手写的 import + 循环。新增纯数据敌人＝丢一个 JSON 进目录、跑一次本脚本，零引擎改动。
//
// 为什么 codegen 而不是 import.meta.glob：引擎被 **Vite(浏览器)** 和 **tsx(回归/CLI)** 双运行时
// 消费；import.meta.glob 只在 Vite 编译期成立，tsx 下是 undefined。生成「静态 import 的 .ts」在
// 两端都成立——这是本项目能做到「零引擎改动 + 双运行时」的唯一干净解。
//
// 用法：
//   node scripts/gen-enemy-registry.mjs           写入/更新生成文件
//   node scripts/gen-enemy-registry.mjs --check    只校验是否最新（不写盘；过期 exit 1·喂 regress）

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENEMIES_DIR = join(HERE, '..', 'src', 'data', 'enemies');
const OUT_BASENAME = 'registry.generated.ts';
const OUT_FILE = join(ENEMIES_DIR, OUT_BASENAME);

/** 文件名 → 合法 TS 标识符（防御非 snake_case 文件名）。 */
function toIdent(filename) {
  let s = filename.replace(/\.json$/, '').replace(/[^A-Za-z0-9_$]/g, '_');
  if (/^[0-9]/.test(s)) s = '_' + s;
  return s;
}

function build() {
  const files = readdirSync(ENEMIES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort(); // 确定性：按文件名排序（lookup 按 id·与顺序无关；list 输出下游再按 id 排序）

  const seen = new Set();
  const imports = [];
  const idents = [];
  for (const f of files) {
    let id = toIdent(f);
    while (seen.has(id)) id = id + '_';
    seen.add(id);
    imports.push(`import ${id} from './${f}';`);
    idents.push(id);
  }

  return `// AUTO-GENERATED · 请勿手改 —— 运行 \`npm run gen:enemies\` 重新生成。
// 来源：src/data/enemies/*.json（敌人库 SPEC 支柱三·目录自动加载）。
// 双运行时安全：静态 import 在 Vite(浏览器) 与 tsx(回归/CLI) 两端都成立；
// 这正是 import.meta.glob（仅 Vite 编译期）做不到、需要 codegen 的原因。
// 过期保护：scripts/check-enemy-refs 会用 \`--check\` 验它与目录一致（regress 门）。

${imports.join('\n')}

/** 单个敌人 JSON 文件的形状：enemies[] + 可选 combatEncounters[]。具体类型在 combat.ts 收口断言。 */
export type EnemyFileModule = { enemies?: unknown[]; combatEncounters?: unknown[] };

/** 目录里全部敌人文件（按文件名排序·确定性）。新增敌人＝丢 JSON 后跑 \`npm run gen:enemies\`。 */
export const ENEMY_FILE_MODULES: EnemyFileModule[] = [
${idents.map((id) => '  ' + id + ',').join('\n')}
] as unknown as EnemyFileModule[];
`;
}

const content = build();
let existing = '';
try {
  existing = readFileSync(OUT_FILE, 'utf8');
} catch {
  /* not yet generated */
}

const isCheck = process.argv.includes('--check');
const count = (content.match(/^import /gm) || []).length;

if (isCheck) {
  if (existing !== content) {
    console.error(
      `✗ ${OUT_BASENAME} 过期：src/data/enemies/ 有增删未同步。请运行  npm run gen:enemies`,
    );
    process.exit(1);
  }
  console.log(`✓ ${OUT_BASENAME} 与目录一致（${count} 个敌人文件）`);
} else if (existing !== content) {
  writeFileSync(OUT_FILE, content);
  console.log(`✓ 写入 ${OUT_BASENAME}（${count} 个敌人文件）`);
} else {
  console.log(`= ${OUT_BASENAME} 已最新（${count} 个敌人文件）`);
}
