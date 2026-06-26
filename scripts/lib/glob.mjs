// 车道 glob 匹配 + 重叠判定（单点真相·取代 psm.mjs 内手搓实现）。
//
// 此前 psm.mjs::lanesOverlap 用「去通配取目录前缀再比」近似重叠——对**中段通配**会漏判：
//   `src/*/items.json` 与 `src/data/items.json` 实际重叠，旧 norm 留 `src/*/items.json` 原样字面比 → 漏（False-Neg）。
//   车道门的整套防撞保证就建立在「重叠＝停下」上，漏判 = 两条 session 静默撞车（最坏方向）。
// 这里换成**分段 glob 交集非空**判定：支持 ** / * / ?；
//   - 字面段不同 → 不重叠（两条不同具体文件不会误判为撞·修了旧实现没有的精度）；
//   - 一侧通配命中另一侧字面 → 重叠（修中段通配漏判）；
//   - 双侧同段都通配 → 保守判重叠（安全方向：宁可多报、不可漏报·车道重叠只是提示去 --force）。
// matchesAnyLane / globToRegExp 维持 psm 旧 laneToRegExp 的语义（无通配且不以 / 结尾 = 目录前缀：lane 自身 + 其下全部）。

// ── glob → RegExp（文件命中某车道·与旧 laneToRegExp 逐字等价）──
export function globToRegExp(lane) {
  let g = String(lane).trim().replace(/^\.?\//, '').replace(/\/+$/, '');
  if (!/[*?]/.test(g)) g = g + '/**|' + g; // 目录前缀：自身及其下全部
  const toRe = (glob) => {
    let re = '';
    for (let i = 0; i < glob.length; i++) {
      const c = glob[i];
      if (c === '*') {
        if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
        else re += '[^/]*';
      } else if (c === '?') re += '[^/]';
      else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return re;
  };
  return new RegExp('^(?:' + g.split('|').map(toRe).join('|') + ')$');
}
// 兼容别名（psm.mjs 旧 export 名·避免外部引用断裂）。
export const laneToRegExp = globToRegExp;

export function matchesAnyLane(file, lanes) {
  const f = String(file).replace(/^\.?\//, '');
  return lanes.some((l) => globToRegExp(l).test(f));
}

// ── 单段 glob（不含 /）→ RegExp，用于段级兼容判定 ──
function singleSegToRe(seg) {
  let re = '';
  for (const c of seg) {
    if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

// 两个**单段** glob 是否存在同时匹配的具体段串？
function segCompatible(s1, s2) {
  if (s1 === s2) return true;
  const w1 = /[*?]/.test(s1), w2 = /[*?]/.test(s2);
  if (!w1 && !w2) return false;        // 两个不同字面段 → 不交（精度：不同具体文件不撞）
  if (w1 && w2) return true;           // 双通配同段 → 保守判交（安全方向）
  const g = w1 ? s1 : s2, lit = w1 ? s2 : s1; // 恰一侧通配 → 它能否匹配另一侧字面
  return singleSegToRe(g).test(lit);
}

// 两个**分段** glob（已 split('/')）是否交集非空？** 跨零或多段。
function segMatch(A, B) {
  if (A.length === 0 && B.length === 0) return true;
  if (A.length && A[0] === '**') {
    if (segMatch(A.slice(1), B)) return true;          // ** 吃零段
    if (B.length && segMatch(A, B.slice(1))) return true; // ** 吃 B 一段
    return false;
  }
  if (B.length && B[0] === '**') {
    if (segMatch(A, B.slice(1))) return true;
    if (A.length && segMatch(A.slice(1), B)) return true;
    return false;
  }
  if (A.length === 0 || B.length === 0) return false;  // 一空一非空且非 ** → 不交
  if (!segCompatible(A[0], B[0])) return false;
  return segMatch(A.slice(1), B.slice(1));
}

// 把车道展开成待比的 glob 模式集（与 globToRegExp 的目录前缀语义一致）。
function expandLane(lane) {
  const g = String(lane).trim().replace(/^\.?\//, '').replace(/\/+$/, '');
  if (!g) return ['**']; // 空车道（理论不该有）→ 视作全匹配·保守
  if (!/[*?]/.test(g)) return [g, g + '/**']; // 目录前缀：自身 + 子树
  return [g];
}

// 两条车道 glob 是否可能重叠（交集非空）。
export function globsOverlap(a, b) {
  for (const pa of expandLane(a)) {
    for (const pb of expandLane(b)) {
      if (segMatch(pa.split('/'), pb.split('/'))) return true;
    }
  }
  return false;
}

// 两组车道是否有任一对重叠。
export function lanesOverlap(lanesA, lanesB) {
  for (const x of lanesA) for (const y of lanesB) if (globsOverlap(x, y)) return true;
  return false;
}
