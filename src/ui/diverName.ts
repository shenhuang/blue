// D-reveal —— 程生姓名的"故障化"渲染（纯 UI 层，不动引擎）。
//
// 重生叙事 D 设定（主 SPEC §决策 / STATUS §4）：早期表现为不同潜水员 → 中期姓名开始故障
// → 终局揭示一直是同一人。这里按 profile.deaths.length 分档渲染死者名：
//   1–4 次：正常（"不同的人"的错觉）
//   5–9 次：笔误（错觉开始裂）
//   10+ 次：故障文字（叠加组合字符 / zalgo-lite）
//   揭示 flag（flag.d_reveal）置位后：直接显示「你」——不管死了多少次。
//
// 确定性：同一 (name, count) 永远输出同一串（用共享 LCG 按 name+count 播种），渲染不会闪。
// 揭示 flag 目前没有任何内容设置它——这是留给后续 lore 事件的钩子（见 STATUS §5 / quirk #42）。

import { makeLcg } from '@/engine/rng';

/** 揭示 flag：置位后所有程生姓名渲染成「你」。由未来 lore 事件设置（暂无内容触发）。 */
export const D_REVEAL_FLAG = 'flag.d_reveal';

const GLITCH_MARKS = ['̀', '́', '̂', '̃', '̈', '̣', '̧'];

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 5–9 次：交换一对相邻字符（同字、同长，仅次序乱） */
function typoName(name: string, rng: () => number): string {
  const chars = [...name];
  if (chars.length < 2) return name;
  const i = Math.floor(rng() * (chars.length - 1));
  [chars[i], chars[i + 1]] = [chars[i + 1], chars[i]];
  return chars.join('');
}

/** 10+ 次：给每个字符叠 1–2 个组合附加符（故障感，但底字还看得出） */
function glitchName(name: string, rng: () => number): string {
  return [...name]
    .map((c) => {
      let out = c;
      const n = 1 + Math.floor(rng() * 2);
      for (let k = 0; k < n; k++) out += GLITCH_MARKS[Math.floor(rng() * GLITCH_MARKS.length)];
      return out;
    })
    .join('');
}

/**
 * 按死亡数 + 揭示 flag 渲染程生姓名。纯函数、确定性。
 * @param rawName 数据里的原名（DeathRecord.diverName）
 * @param deathsCount profile.deaths.length（含刚死的那个）
 * @param revealed 是否已触发 D-reveal（profile.flags.has(D_REVEAL_FLAG)）
 */
export function renderDiverName(rawName: string, deathsCount: number, revealed: boolean): string {
  if (revealed) return '你';
  if (deathsCount < 5) return rawName;
  const rng = makeLcg(hashStr(rawName) + deathsCount);
  if (deathsCount < 10) return typoName(rawName, rng);
  return glitchName(rawName, rng);
}
