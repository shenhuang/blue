// tsx/node ESM loader：把任何 .css import 重定向到空替身模块（_empty-css.mjs）。
// 仅 SSR 冒烟用——Vite 构建才真正处理 .css；node/tsx 不认 .css 扩展会炸。
// resolve 钩子（非 load）最稳：重定向到真实 .mjs·tsx/node 正常加载·不触发对 css 的 transform。
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const STUB = new URL('file://' + join(dirname(fileURLToPath(import.meta.url)), '_empty-css.mjs')).href;
export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.css')) return { url: STUB, shortCircuit: true };
  return nextResolve(specifier, context);
}
