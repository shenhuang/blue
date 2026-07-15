// 剧情脊柱（St0 骨架）——⚠ 旧「剧情 SPEC」已随 #300「彻底白板」删除（2026-07-12·tutorial+ch1 主线整删）。
// 本模块现为**休眠脚手架**（allStoryFlags/ch1Story/chapterUnlocked 当前无调用点）；下方 §引用皆指向
// 已删文档、仅存历史线索，口径待主线重建重定。终局方向见 docs/spec/深海回响_大深渊结局_SPEC.md。
// （原 CHANGELOG #115）
//
// 章节/节拍状态**从 profile.flags 派生**——flags 是唯一事实来源，本模块零自有状态、
// 零存档字段（沿 #66 outpostStageFlag / #69 setProfileFlags 的 additive 套路，不 bump
// SAVE_VERSION；quirk #99：改坏形状才 bump 弃档，纯加 flag 永远安全）。
//
// 命名口径：`story.<章>.<节拍>`
//   - story.ch1.hook              教学钩：半本日志开场已读（教学关 prologue 经
//                                 setProfileFlags 写入——dive 中也持久，死在教学关不丢钩）
//   - story.ch1.anchor.<id>       一章四锚点节拍位（St1 实装锚点链时由锚点事件置位）
//   - story.ch1.ending.fulfilled  圆满结局位（canon：主角以为的真结局·按当时为真）
//   - story.ch1.ending.blank      留白结局位（持破损饰品的清醒重访·见下 charm_found）
//   - story.ch1.charm_found       破损饰品（导师遗物·缺宝石）已获得位（= 留白结局重访门）
// flag 字符串**只在本模块生成**（单一来源）；data JSON 里出现的字面量必须与这里的生成器输出一致。
//
// ⚠ #297 曾定「删 recording_1 + ending_blank」：`ch1.recording.*` 已删（自足·无消费者）；
// `ending.blank` **保留**——它是「留白结局重访」子系统（CH1_CHARM_FOUND_FLAG + chart.ts revisit* +
// dive-start 重访分支）的键石，单拆会留孤儿管线·整体退休需作者授权·别 drive-by。
//
// 词汇隔离：叙事「章」(chapter) ≠ 机制「Phase」。本模块只管叙事章。
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
 * 一章四锚点（锚点链推进顺序即数组顺序）：
 * 近海珊瑚礁 → 礁后陆坡 → 远洋中层 → 海沟+热液。
 * St0 只立节拍位；锚点事件/POI 归 St1。（旧剧情 SPEC §4.1 已随 #300 删除。）
 */
export const CH1_ANCHORS = ['reef', 'slope', 'midwater', 'vent'] as const;
export type Ch1Anchor = (typeof CH1_ANCHORS)[number];

/** 一章结局位。fulfilled=圆满（canon：当时为真）；blank=留白（更难解锁·清醒重访）。 */
export type Ch1Ending = 'fulfilled' | 'blank';

// ---------------------------------------------------------------------------
// flag 命名（单一来源——别处不许手拼 story.* 字符串）
// ---------------------------------------------------------------------------

/** 教学钩：半本日志开场钩已种（教学关 tutorial.prologue 置位）。 */
export const CH1_HOOK_FLAG = 'story.ch1.hook';

// 主线四坐标「已知」的真相不再是一个裸 flag（旧 story.ch1.coords_known 已撤·2026-06-28 内容自洽回归）：
// reveal 的单一来源＝「日志文献坐标」——导师日志（items.json mentor_logbook）的 story.marksPois 带四条柱派生
// story 潜点 id（poi.dive.<短名>.story），poisKnownFromItems ⇒「知道坐标」；engine/columns.ts::storyPoiRevealState
// 据此早揭示（dim/lit·host build-gate）。这恢复了 #117「story 锚点＝日志已知坐标·marksPois ⇒ reveal」已记录机制，
// 与教学「照着日志把坐标逐条比对·圈下四个坐标」自洽（导师日志「携带」四坐标·而非置一个抽象 flag）。

/** 一章锚点节拍位 flag（St1 锚点事件用 setProfileFlags 置位）。 */
export function ch1AnchorFlag(anchor: Ch1Anchor): string {
  return `story.ch1.anchor.${anchor}`;
}

/** 一章结局位 flag。 */
export function ch1EndingFlag(ending: Ch1Ending): string {
  return `story.ch1.ending.${ending}`;
}

// ch1RecordingFlag 已删（#297 定删 recording·自足无消费者；录音分段 canon 随旧剧情 SPEC §4.4 作废·待主线重建重立）。

/**
 * 破损饰品（导师遗物·托里嵌宝石处裂空）已获得 flag —— **留白结局重访门**（旧剧情 SPEC §4.1·已随 #300 删）。
 * 语义：持有破损饰品 ⟺ 已达圆满结局（饰品是圆满的拾取物）＝ fulfilled-first，**保证圆满在前、第一次绝不
 * 跳过留白**。dive-start.ts 读它决定是否在 vent POI 重访时强制 ending_blank（generic revisit 字段·非硬引用）。
 * 由 ch1.ending（圆满）outcome.setProfileFlags + 破损饰品 item.story.setsFlag 双置（幂等·不软锁）。
 * （ending.blank 子系统整体口径待主线重建重定·见文件头 #297 note。）
 */
export const CH1_CHARM_FOUND_FLAG = 'story.ch1.charm_found';

/**
 * 既有教学完成 flag 收编为常量（**不改名**——chart_pois.json requiresFlags /
 * PortView 海图门 / MapDevPanel 都钉着这个字符串，改名=弃档级改动，St0 不做）。
 */
export const TUTORIAL_COMPLETE_FLAG = 'flag.tutorial_complete';

/**
 * 海沟章节前哨解锁占位 flag（outpost.ch1_trench 的 requiresFlag·区域揭示 SPEC §5）：
 * 作者之后接剧情节拍置位。登记进单一来源＝lighthouse_upgrades.json 里那条字面量从此受
 * playthrough-story §4「data story.* 字面量 ⊆ allStoryFlags()」守门（此前是手拼裸字符串·无人守）。
 */
export const TRENCH_FOUND_FLAG = 'story.ch1.trench_found';

/**
 * story.ts 生成的**全部** story.* flag 枚举（单一来源）。原「data story.* 字面量 ⊆ 本集合」的
 * playthrough-story 守门脚本已随 #300 白板删除，本函数当前**无调用点**（休眠）；主线重建时恢复守门。
 * 新增任何 story flag 生成器仍在此登记（把「门=flag·派生进 story.ts」焊成机制·CLAUDE.md「约定落成机制」）。
 */
export function allStoryFlags(): string[] {
  return [
    CH1_HOOK_FLAG,
    ...CH1_ANCHORS.map((a) => ch1AnchorFlag(a)),
    ch1EndingFlag('fulfilled'),
    ch1EndingFlag('blank'),
    CH1_CHARM_FOUND_FLAG,
    TRENCH_FOUND_FLAG,
  ];
}

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
 * 章节解锁判定（占位·解锁链·旧剧情 SPEC §1 已随 #300 删）：
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
