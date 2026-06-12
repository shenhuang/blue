// 剧情脊柱（St0 · 剧情 SPEC §8 路线图第一步 · CHANGELOG #115）
//
// 章节/节拍状态**从 profile.flags 派生**——flags 是唯一事实来源，本模块零自有状态、
// 零存档字段（沿 #66 outpostStageFlag / #69 setProfileFlags 的 additive 套路，不 bump
// SAVE_VERSION；quirk #99：改坏形状才 bump 弃档，纯加 flag 永远安全）。
//
// 命名口径（剧情 SPEC §8 St0 行锁定）：`story.<章>.<节拍>`
//   - story.ch1.hook              教学钩：半本日志开场已读（教学关 prologue 经
//                                 setProfileFlags 写入——dive 中也持久，死在教学关不丢钩）
//   - story.ch1.anchor.<id>       一章四锚点节拍位（St1 实装锚点链时由锚点事件置位）
//   - story.ch1.ending.fulfilled  圆满结局位（St1 末实装；canon：主角以为的真结局·按当时为真）
//   - story.ch1.ending.blank      留白结局位（St2 实装；更难的清醒重访）
// flag 字符串**只在本模块生成**（单一来源）；data JSON 里出现的字面量必须与这里的
// 生成器输出一致（playthrough-story §4 守这条——手拼漂移会红）。
//
// 词汇隔离（剧情 SPEC §1）：叙事「章」(chapter) ≠ 机制「Phase」。本模块只管叙事章。
// 红线（quirk #117）：本模块只做状态派生，**不携带任何剧透文案**；一二章对
// 「失联真相/断片说」零泄漏的纪律由内容侧遵守，这里不出现相关字符串。
//
// 边界：engine↛ui（check-boundaries 规则一自动覆盖 src/engine/**）。UI 读剧情状态
// 一律走 ch1Story()/chapterUnlocked()，别在 UI 里手拼 'story.*' 字符串。

import type { PlayerProfile } from '@/types';

// ---------------------------------------------------------------------------
// 章节与节拍标识
// ---------------------------------------------------------------------------

/** 叙事章 id。St0 只开 ch1 与 ch2 占位（解锁判定需要 ch2 这个名字）；后续章按需追加。 */
export type ChapterId = 'ch1' | 'ch2';

/**
 * 一章四锚点（剧情 SPEC §4.1 表序·锚点链推进顺序即数组顺序）：
 * 近海珊瑚礁 → 温带沉船 → 远洋中层 → 海沟+热液。
 * St0 只立节拍位；锚点事件/POI 归 St1。
 */
export const CH1_ANCHORS = ['reef', 'wreck', 'midwater', 'vent'] as const;
export type Ch1Anchor = (typeof CH1_ANCHORS)[number];

/** 一章结局位。fulfilled=圆满（canon：当时为真）；blank=留白（更难解锁·清醒重访）。 */
export type Ch1Ending = 'fulfilled' | 'blank';

// ---------------------------------------------------------------------------
// flag 命名（单一来源——别处不许手拼 story.* 字符串）
// ---------------------------------------------------------------------------

/** 教学钩：半本日志开场钩已种（教学关 tutorial.prologue 置位）。 */
export const CH1_HOOK_FLAG = 'story.ch1.hook';

/** 一章锚点节拍位 flag（St1 锚点事件用 setProfileFlags 置位）。 */
export function ch1AnchorFlag(anchor: Ch1Anchor): string {
  return `story.ch1.anchor.${anchor}`;
}

/** 一章结局位 flag。 */
export function ch1EndingFlag(ending: Ch1Ending): string {
  return `story.ch1.ending.${ending}`;
}

/**
 * 既有教学完成 flag 收编为常量（**不改名**——chart_pois.json requiresFlags /
 * PortView 海图门 / MapDevPanel 都钉着这个字符串，改名=弃档级改动，St0 不做）。
 */
export const TUTORIAL_COMPLETE_FLAG = 'flag.tutorial_complete';

// ---------------------------------------------------------------------------
// 派生（纯函数·只读 profile.flags）
// ---------------------------------------------------------------------------

/** 一章剧情状态（全部从 profile.flags 派生·无自有存储）。 */
export interface Ch1Story {
  /** 半本日志开场钩已种（教学关 prologue 已读）。 */
  hooked: boolean;
  /** 教学关已完成（=海图解锁同源 flag）。 */
  tutorialComplete: boolean;
  /** 已置位的锚点（按 CH1_ANCHORS 的 canonical 顺序）。 */
  anchorsDone: Ch1Anchor[];
  /** 下一个待推进锚点（按链序取第一个未置位；全齐 = null）。 */
  nextAnchor: Ch1Anchor | null;
  /** 结局位（两个可同存：留白是圆满之后的更难重访，不互斥）。 */
  endings: { fulfilled: boolean; blank: boolean };
  /**
   * 一章主线走完 = 圆满结局达成（占位判定·St1 末实装置位）。
   * 注意按 canon 这是「主角以为的真结局」——complete 只是机制口径，不裁决真假。
   */
  complete: boolean;
}

/** 从 profile.flags 派生一章剧情状态。 */
export function ch1Story(profile: PlayerProfile): Ch1Story {
  const flags = profile.flags;
  const anchorsDone = CH1_ANCHORS.filter((a) => flags.has(ch1AnchorFlag(a)));
  const nextAnchor = CH1_ANCHORS.find((a) => !flags.has(ch1AnchorFlag(a))) ?? null;
  const fulfilled = flags.has(ch1EndingFlag('fulfilled'));
  return {
    hooked: flags.has(CH1_HOOK_FLAG),
    tutorialComplete: flags.has(TUTORIAL_COMPLETE_FLAG),
    anchorsDone,
    nextAnchor,
    endings: { fulfilled, blank: flags.has(ch1EndingFlag('blank')) },
    complete: fulfilled,
  };
}

/**
 * 章节解锁判定（占位·剧情 SPEC §1 解锁链）：
 *   - ch1：教学关完成即开（与海图解锁同一道门——四锚点 POI 在 St1 都会走
 *     requiresFlags: [flag.tutorial_complete] 的既有门控通道）。
 *   - ch2：一章圆满（解锁链「一章圆满 → 二章」；St5 实装内容，这里先把判定立住）。
 */
export function chapterUnlocked(profile: PlayerProfile, chapter: ChapterId): boolean {
  switch (chapter) {
    case 'ch1':
      return profile.flags.has(TUTORIAL_COMPLETE_FLAG);
    case 'ch2':
      return ch1Story(profile).complete;
  }
}
