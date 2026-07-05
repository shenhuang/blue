// 深度 band 注册表 —— 深水区 Phase 1「可扩展纵向深度轴」。
// 把 src/data/depth_bands.json 解析成按 order 升序（越来越深）的阶梯 + id 索引。
// band 引用 zone 提供内容、用自己的绝对 depthRange 覆盖 zone.depthRange（经 diveIntoBand（经 startDiveFromPoi） → mapgen）。
// 软门控：band 不带硬解锁——可达性由装备（声呐解锁 + 电池/升级，见 quirk #60）+ 后续强敌决定。

import type { BandsFile, DepthBand, PoiModifier } from '@/types';
import bandsData from '@/data/depth_bands.json';
import { columnBands } from './columns';

const file = bandsData as unknown as BandsFile;

/**
 * 全部 band，按 order 升序（order 越大越深）。两个来源（#131）：
 *   - depth_bands.json：手写 band——现仅剩 abyssal/hadal/subhadal/nameless『另一个世界』预留 band
 *     （暂无深度柱档抵达·专门 Phase 接·见 deep_game_vision）+ 任何非柱 band；
 *   - columnBands()：depth_columns.json 各柱每级派生的深度档 band（band.<短名>.t<tier>·#131 主体）。
 * 合并后按 order 排序（柱 band 的 order＝顶深·与预留 band 的深度顺序一致）。
 */
const BANDS: DepthBand[] = [...file.bands, ...columnBands()].sort((a, b) => a.order - b.order);
const INDEX: Map<string, DepthBand> = new Map(BANDS.map((b) => [b.id, b]));

export function getBands(): DepthBand[] {
  return BANDS;
}

export function getBand(id: string): DepthBand | undefined {
  return INDEX.get(id);
}

/**
 * band 的环境修正（落 run.diveModifier）：gate（整潜门·感知门 SPEC §2.1）/ current。
 * 深度不走 depthOffset——band 用绝对 depthRange 覆盖 zone（见 mapgen GenOpts.depthRange / diveIntoBand（经 startDiveFromPoi））。
 * 深 band 的 gate={sense:'lamp',mode:'locked'} 是软门控的核心：灯打不透 → 被迫用更耗电的声呐（间接电量压力，不加深度耗电税）。
 */
export function bandDiveModifier(band: DepthBand): PoiModifier {
  return { gate: band.gate, current: band.current };
}
