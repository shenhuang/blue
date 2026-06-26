#!/usr/bin/env node
// 工具链自测 runner —— 跑 scripts/__tests__/*.test.mjs（node:test 程序化 API·v22 稳定）。
//
// 为什么不是 `node --test scripts/__tests__`：本机 Node 把目录参数当成 CJS 入口去 require、
// 解析失败（非 shell 展开时拿不到文件列表）。这里用 run({files}) 自己列目录喂进去——
// 新增 *.test.mjs 自动纳入（readdir·不必逐个登记），且在 regress 的 spawn(argv) 无 shell 环境下可靠。
//
// 守 Agent 审计 #6：check-branch.decide / check-append-only-docs.decide / affected.computeAffected /
// lib/{glob,args,env} 这些「便于单测」却一直没接测的纯函数——把守每次 commit 的门自己焊上测试。
//
// 在 scripts/regress.mjs 注册为 check-tooling 任务（纯 node·无 esbuild·沙箱也跑）。
//   跑法： node scripts/run-tooling-tests.mjs

import { run } from 'node:test';
import { tap } from 'node:test/reporters';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '__tests__');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.test.mjs'))
  .map((f) => join(dir, f));

let failed = 0;
const stream = run({ files });
stream.on('test:fail', () => { failed++; });
stream.compose(tap).pipe(process.stdout);
stream.on('end', () => { process.exitCode = failed ? 1 : 0; });
