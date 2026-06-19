#!/usr/bin/env node
// 声明本 session 的写手身份（并发隔离方案 A·quirk #104）——写/清仓库根 .blue-writer 标记，
// 供 check-branch 门判断（见 scripts/check-branch.mjs）。.blue-writer 已 gitignore·每棵工作树各一份。
//
//   node scripts/set-writer.mjs weekend       周末内容 / POI session：切到 auto/weekend + 标记 weekend
//   node scripts/set-writer.mjs interactive   交互 session：清标记（回默认·留在 main/feat 工作）
//   node scripts/set-writer.mjs nightly       夜间 verify/publish：标记 nightly（跨分支放行）
//
// package.json 暴露为 `npm run weekend:start` / `npm run main:resume`。

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = join(ROOT, '.blue-writer');
const WEEKEND_BRANCH = 'auto/weekend';

const writer = (process.argv[2] || '').trim().toLowerCase();
const VALID = new Set(['weekend', 'interactive', 'nightly']);
if (!VALID.has(writer)) {
  console.error(`用法：node scripts/set-writer.mjs <weekend|interactive|nightly>（收到 '${process.argv[2] ?? ''}'）`);
  process.exit(2);
}

function git(args) {
  return execFileSync('git', ['--no-optional-locks', ...args], { cwd: ROOT, encoding: 'utf-8' }).trim();
}

if (writer === 'interactive') {
  // 沙箱不能 unlink（mount 约束·quirk #104/#1）→ 不删标记、改写值为 interactive（写入允许）。
  // 语义等价于「无标记」：check-branch 把 interactive 当默认交互处理（只在 auto/weekend 才拦）。
  writeFileSync(MARKER, 'interactive\n');
  console.log('✓ 已写 .blue-writer=interactive → 回交互写手。分支门只在 auto/weekend 才拦你（quirk #104）。');
  process.exit(0);
}

if (writer === 'weekend') {
  // 切到（或新建）auto/weekend。沙箱 checkout 只能加文件方向（main→auto/weekend 通常可行·quirk #104b）；
  // 切不动就警告但仍写标记——让作者本机/独立 worktree 完成切换。
  let branch = '(未知)';
  try {
    branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  } catch {
    /* ignore */
  }
  if (branch !== WEEKEND_BRANCH) {
    const exists = (() => {
      try {
        git(['rev-parse', '--verify', '--quiet', WEEKEND_BRANCH]);
        return true;
      } catch {
        return false;
      }
    })();
    try {
      git(exists ? ['checkout', WEEKEND_BRANCH] : ['checkout', '-b', WEEKEND_BRANCH]);
      console.log(`✓ 已切到 ${WEEKEND_BRANCH}${exists ? '' : '（新建）'}。`);
    } catch (e) {
      console.warn(
        `⚠ 切到 ${WEEKEND_BRANCH} 失败（沙箱 unlink 约束？·quirk #104b）：${String(e.message || e).split('\n')[0]}\n` +
          `  已写标记；请本机 \`git checkout ${WEEKEND_BRANCH}\` 或在独立 worktree（方案 B）里跑。`,
      );
    }
  } else {
    console.log(`✓ 已在 ${WEEKEND_BRANCH}。`);
  }
  writeFileSync(MARKER, 'weekend\n');
  console.log('✓ 已写 .blue-writer=weekend。此后 check-branch 只放行 auto/weekend 上的提交（quirk #104）。');
  process.exit(0);
}

// nightly
writeFileSync(MARKER, 'nightly\n');
console.log('✓ 已写 .blue-writer=nightly → 跨分支 verify/publish 放行分支门（quirk #104）。也可改用 BLUE_WRITER=nightly 环境变量。');
process.exit(0);
