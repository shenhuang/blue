// 共享的线性同余 RNG（Numerical Recipes 经典参数）。
//
// 项目里凡是需要"走入参的确定性随机"都用这一份：海图 roaming 抽取（chart.ts）、
// 事件回归的全局 patch（eventScenario.ts::withSeededRandom）、地图调试器（MapDevPanel）。
// 回归脚本（scripts/*）各自内联了同样的常数（它们是独立 test harness，不依赖 src 也能跑）——
// 改这里的算法/常数时记得 scripts 那几份要一起对齐（quirk #22：全项目同一套 LCG 数）。
export function makeLcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * 确定性字符串哈希（FNV-1a → uint32）。给"走字符串入参的确定性随机"用——
 * 如尸体海流冲走判定（death.ts::deterministicSwept·按 `deathId|itemId` 派生一个稳定 u∈[0,1)）。
 * 纯函数、可复现、不入存档（同 makeLcg 族·quirk #22）。注：chart.ts 另有数值版 condHash（seed+salt），
 * 若日后要统一字符串/数值哈希再收口到此处。
 */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
