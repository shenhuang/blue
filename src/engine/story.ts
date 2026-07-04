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
//   - story.ch1.ending.blank      留白结局位（St2 实装；持破损饰品的清醒重访·见下 charm_found）
//   - story.ch1.recording.<n>     一章水下录音碎片位（St2 实装第 1 段；分段 canon §4.4·2+ 段留二章）
//   - story.ch1.charm_found       破损饰品（导师遗物·缺宝石）已获得位（St2 实装；= 留白结局重访门）
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

/**
 * 一章水下录音碎片 flag（St2·剧情 SPEC §3.2「录音=真伪锚点」/§4.1 留白结局得第 1 段）。
 * 分段 canon（§4.4「录音分段化」）：留白给第 1 段；2+ 段藏于一章更强关底 + 二章回流——**机制留二章**
 * （Q4·机制按需长出），本模块现仅生成并登记第 1 段（离散 flag·随 profile.flags Set 往返·确定性）。
 */
export function ch1RecordingFlag(segment: number): string {
  return `story.ch1.recording.${segment}`;
}

/**
 * 破损饰品（导师遗物·托里嵌宝石处裂空）已获得 flag —— **留白结局重访门**（St2·剧情 SPEC §4.1）。
 * 语义：持有破损饰品 ⟺ 已达圆满结局（饰品是圆满的拾取物）＝ fulfilled-first，**保证圆满在前、第一次绝不
 * 跳过留白**。dive-start.ts 读它决定是否在 vent POI 重访时强制 ending_blank。破损饰品的「稳住幻象一拍」
 * 真·抵消能力 + 二章宝石材料修复（一章只钻石/二章群宝·新材料类）都留二章——见剧情 SPEC §4.4。
 * 由 ch1.ending（圆满）outcome.setProfileFlags + 破损饰品 item.story.setsFlag 双置（幂等·不软锁）。
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

// ---------------------------------------------------------------------------
// 鲸落支线（非主线·§10 鲸落区细化·CHANGELOG #120 续）
// ---------------------------------------------------------------------------
// 中层区下潜目击巨型生物：每次目击置一个**计数位** flag；满 SIGHTINGS_FOR_SEARCH(3)
// 时由当次目击事件**显式**置 WHALE_SEARCH_READY_FLAG（把阈值物化成真 flag——门保持
// flag-AND、不引「count ≥ N」条件 DSL；变化全在「谁来置 flag」的触发侧·见 2026-06-14
// 架构讨论决策①②）。残骸区另有一处**独立**目击（WHALE_SIGHTING_WRECK_FLAG·不计入
// 计数·独立剧情·§10）。找到鲸落区后置 WHALEFALL_FOUND_FLAG（= chart_regions 鲸落区的
// revealFlag·owner-less flag-gated 揭示）。全部 flag 只在本模块生成（单一来源·quirk
// #118·playthrough-story §4 守「data 里出现的 story.* 字面量 ⊆ allStoryFlags()」）。

/** 触发「找寻」所需的中层目击次数（§10 作者拍·满 3 次）。 */
export const SIGHTINGS_FOR_SEARCH = 3;

/** 中层目击计数位 flag（n = 1..SIGHTINGS_FOR_SEARCH·离散 flag·随 profile.flags(Set) 往返·确定性）。 */
export function whaleSightingFlag(n: number): string {
  return `story.ch1.whale_sighting.${n}`;
}

/** 残骸区独立目击 flag（独立剧情·**不计入**中层计数·§10）。 */
export const WHALE_SIGHTING_WRECK_FLAG = 'story.ch1.whale_sighting.wreck';

/** 「找寻」就绪 flag（满 SIGHTINGS_FOR_SEARCH 次中层目击时由当次事件物化置位·探索潜点发现门）。 */
export const WHALE_SEARCH_READY_FLAG = 'story.ch1.whale_search_ready';

/** 找到鲸落区 flag（= chart_regions 鲸落区 revealFlag·flag-gated region 揭示门）。 */
export const WHALEFALL_FOUND_FLAG = 'story.ch1.whalefall_found';

/**
 * 海沟科考站电梯 capstone 揭示 flag（#131·SPEC §10）：建海沟探深第 4 级（电梯·module-gated）即由
 * depth_columns trench t4 的 setsFlag 置位 → chart_regions 科考站 flag-gated 区揭示（= 其 revealFlag·
 * 复用 #124 owner-less 区原语）。科考站＝一章收束剧情占位 + 接口（后章回来往下接·Phase 3 在此长出）。
 */
export const STATION_FOUND_FLAG = 'story.ch1.station_found';

/**
 * 热液探深 capstone 情报里程碑（核心+情报·2026-06-20）：建热液探深第 4 级（裂口·capstone）即由 depth_columns
 * vent t4 的 setsFlag 置位。语义＝在喷口深处撬下古文明「下行动力核心」（item.station_module·海沟电梯 cost 消费它
 * ＝必经热液）时，一并读到那批古机械的记录 → 拼出通往更深处的一段情报（「灯塔＝信息基建」「真结局引大深渊情报」）。
 * 现为里程碑 hook（Phase 3「另一个世界」在海沟电梯之下长出时消费·别擅自动 d_reveal·见 deep_game_vision）。
 */
export const VENT_INTEL_FLAG = 'story.ch1.vent_intel';

/**
 * Corin 藏宝线 flag（黑背鸥小队幸存者 Sela 的第一条同伴线·藏宝贸易与信任系统 SPEC §12.3）：
 * corin_map = 从 Sela 取得 Corin 的测绘图（item.treasure_map.corin_survey.story.setsFlag·并揭示 poi.anchor.corin_cache）；
 * corin_found = 到点开箱事件置位（chart_pois openEventFlag·一次性强制开场）；
 * corin_returned = 回港把红喉鹈徽章交还 Sela（对话 setFlag·涨信任）。
 * 全为**支线**——§8 红线：关系/藏宝 flag 不挡通关必经进度（不进任何主线 reach/reveal gate）。
 */
export const CORIN_MAP_FLAG = 'story.ch1.corin_map';
export const CORIN_FOUND_FLAG = 'story.ch1.corin_found';
export const CORIN_RETURNED_FLAG = 'story.ch1.corin_returned';

/**
 * Mira 打捞委托 flag（销赃中间人「验明正身」门·藏宝贸易与信任系统 SPEC §6/§12·2026-07-03）：
 * mira_salvage_offered = Mira 在港口对话里把委托交给你（dialog setFlag·揭示 poi.anchor.mira_salvage）；
 * mira_salvage_done    = 到点撬开铅封匣事件置位（chart_pois openEventFlag + 事件 setProfileFlags·一次性）。
 * **单一旋钮＝任务位置**：深度不再直接门 sela_tip（引荐），只写在 mira_salvage POI 的 offer 门上——
 * 挪任务＝Sela 可达点自动跟着走（quirk 见 SPEC）。sela_tip 改由 mira_salvage_done 门控（做完任务⟹见得到 Sela）。
 * 全为**支线**——§8 红线：关系/藏宝 flag 不挡通关必经进度（不进任何主线 reach/reveal gate）。
 */
export const MIRA_SALVAGE_OFFERED_FLAG = 'story.ch1.mira_salvage_offered';
export const MIRA_SALVAGE_DONE_FLAG = 'story.ch1.mira_salvage_done';

/**
 * story.ts 生成的**全部** story.* flag 枚举（单一来源）。playthrough-story §4 据此守门
 * 「任何 data 文件里出现的 story.* 字面量都必须 ∈ 本集合」——新增任何 story flag 生成器
 * 务必在此登记，否则用到它的 data 会在 regress 红（这是把「门=flag·派生进 story.ts」
 * 焊成会失败的检查的关键·CLAUDE.md 顶部「约定落成机制」）。
 */
export function allStoryFlags(): string[] {
  return [
    CH1_HOOK_FLAG,
    ...CH1_ANCHORS.map((a) => ch1AnchorFlag(a)),
    ch1EndingFlag('fulfilled'),
    ch1EndingFlag('blank'),
    ch1RecordingFlag(1),
    CH1_CHARM_FOUND_FLAG,
    TRENCH_FOUND_FLAG,
    ...Array.from({ length: SIGHTINGS_FOR_SEARCH }, (_, i) => whaleSightingFlag(i + 1)),
    WHALE_SIGHTING_WRECK_FLAG,
    WHALE_SEARCH_READY_FLAG,
    WHALEFALL_FOUND_FLAG,
    STATION_FOUND_FLAG,
    VENT_INTEL_FLAG,
    CORIN_MAP_FLAG,
    CORIN_FOUND_FLAG,
    CORIN_RETURNED_FLAG,
    MIRA_SALVAGE_OFFERED_FLAG,
    MIRA_SALVAGE_DONE_FLAG,
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

/** 鲸落支线状态（全部从 profile.flags 派生·无自有存储·非主线）。 */
export interface Ch1WhaleStory {
  /** 已置位的中层目击计数（0..SIGHTINGS_FOR_SEARCH）。 */
  sightings: number;
  /** 「找寻」是否就绪（探索潜点出现的门·WHALE_SEARCH_READY_FLAG 置位）。 */
  searchReady: boolean;
  /** 残骸区独立目击是否已发生（独立剧情·不计入计数）。 */
  wreckSeen: boolean;
  /** 是否已找到鲸落区（flag-gated region 揭示·WHALEFALL_FOUND_FLAG 置位）。 */
  found: boolean;
}

/** 从 profile.flags 派生鲸落支线状态（单一来源）。 */
export function ch1WhaleStory(profile: PlayerProfile): Ch1WhaleStory {
  const flags = profile.flags;
  let sightings = 0;
  for (let n = 1; n <= SIGHTINGS_FOR_SEARCH; n++) {
    if (flags.has(whaleSightingFlag(n))) sightings++;
  }
  return {
    sightings,
    searchReady: flags.has(WHALE_SEARCH_READY_FLAG),
    wreckSeen: flags.has(WHALE_SIGHTING_WRECK_FLAG),
    found: flags.has(WHALEFALL_FOUND_FLAG),
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
