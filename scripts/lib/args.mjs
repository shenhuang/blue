// 极简 argv 解析（单点真相）。
//
// 取代此前各异的三处实现：psm.mjs::parseFlags（对象式 + 位置参数）、regress.mjs::flag、
// affected-tests.mjs::flag（单值式）。语义统一、负数值安全，便于单测（scripts/__tests__/args.test.mjs）。

/**
 * 对象式解析：`--k v` → {k:'v'}；`--k`（末尾或后接另一 `--x`）→ {k:true}；非 `--` 开头 → 位置参数 _。
 * 负数值安全：`--n -1` → {n:'-1'}（值以 `-` 开头但非 `--`，按值吃下）。
 * @param {string[]} argv
 * @returns {{_:string[]} & Record<string, string|true>}
 */
export function parseFlags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) out[k] = argv[++i];
      else out[k] = true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

/**
 * 单值取 flag（与 regress/affected 旧 flag() 等价）：不存在 → null；存在但无值（末尾）→ ''。
 * @param {string[]} argv
 * @param {string} name 含 `--` 前缀，如 '--only'
 * @returns {string|null}
 */
export function getFlag(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  return argv[i + 1] ?? '';
}
