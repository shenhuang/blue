// 敌人头像图标（占位线稿·作者 2026-07-02）——跟 ui/itemIcons.tsx 同一套画风（stroke=currentColor
// 的线稿 SVG）、同一套分层兜底思路：敌人库目前没有「体型/物种」这种可机器读的轴，只能手挑分类；
// 逐只画真立绘是打磨期的事（见 defer-number-tuning / ui-tidy-preference 两条记忆里的"先占位后打磨"），
// 这里先按大轮廓分成几类形状——比之前的"名字首字"占位更像一只敌人，也是往后逐只补 GLYPH 的落点。
//
// 单一来源：EnemyPortrait 只要 defId 就能出图。新敌人不在 ENEMY_SILHOUETTE 里 → 兜底 'fish'，
// 不会因为漏配置而空着或报错；要专属形状，往 ENEMY_SILHOUETTE 加一条映射到某个轮廓即可。

import type { ReactNode } from 'react';

export type EnemySilhouette =
  | 'shark'
  | 'fish'
  | 'eel'
  | 'octopus'
  | 'crab'
  | 'jellyfish'
  | 'orb'
  | 'humanoid'
  | 'fungal';

const SILHOUETTE_GLYPH: Record<EnemySilhouette, ReactNode> = {
  shark: (<><path d="M2 13c4-5 9-6 13-4 2-2 5-3 7-2-1 2-2 3-3 3.5 1 .8 2 2 3 3.5-2 1-5 0-7-2-4 2-9 1-13-4z"/><path d="M9 9.5V5l3 3.5"/><circle cx="6" cy="12.5" r="0.7"/></>),
  fish: (<><path d="M3 12c4-5 12-5 16 0-4 5-12 5-16 0z"/><path d="M19 12l3-3v6z"/><circle cx="7" cy="11.2" r="0.8"/></>),
  eel: (<><path d="M3 17c2-7 3-12 7-12s3 6 6 6 3-4 3-4"/><circle cx="5.4" cy="15.4" r="0.8"/></>),
  octopus: (<><path d="M7 10a5 5 0 0 1 10 0v2"/><circle cx="9.6" cy="9" r="0.8"/><circle cx="14.4" cy="9" r="0.8"/><path d="M6 12c-1 3-1 5 0 8M9 12c-.4 3-.4 6 .6 9M12 12v9M15 12c.4 3 .4 6-.6 9M18 12c1 3 1 5 0 8"/></>),
  crab: (<><path d="M7 13a5 4 0 0 1 10 0z"/><path d="M5 11l2 1M19 11l-2 1M8 16l-2 3M16 16l2 3M10 16l-1 3M14 16l1 3"/></>),
  jellyfish: (<><path d="M6 10a6 4 0 0 1 12 0z"/><path d="M8 10c0 4 0 7-1 10M11 10c0 4 .4 7-.4 10M14 10c0 4-.4 7 .4 10M17 10c0 4 0 7 1 10"/></>),
  orb: (<><circle cx="12" cy="12" r="7"/><path d="M9 9a4 4 0 0 1 5 1M9 14a4 4 0 0 0 6 0"/></>),
  humanoid: (<><circle cx="12" cy="6" r="2.6"/><path d="M12 8.6v6.4M8 12.5 12 11l4 1.5M9 21l3-6 3 6"/></>),
  fungal: (<><path d="M6 12a6 4 0 0 1 12 0z"/><path d="M9 12v6a3 3 0 0 0 6 0v-6"/></>),
};

// 手挑映射（敌人库 15 个 JSON 文件·约 18 个 defId·2026-07-02 逐条核过一次）。
// 不在表里的新 defId 兜底 'fish'——不会漏画，只是不够贴切，等作者补一条映射即可。
const ENEMY_SILHOUETTE: Record<string, EnemySilhouette> = {
  'enemy.reef_shark.tutorial': 'shark',
  'enemy.reef_barracuda': 'fish',
  'enemy.reef_barracuda_juv': 'fish',
  'enemy.reef_grouper': 'fish',
  'enemy.cave_grouper_boss': 'fish',
  'enemy.scavenger': 'fish',
  'enemy.blind_eel': 'eel',
  'enemy.blind_eel_juv': 'eel',
  'enemy.chain_eel_node': 'eel',
  'enemy.chain_eel_head': 'eel',
  'enemy.cave_octopus': 'octopus',
  'enemy.wreck_spider_crab': 'crab',
  'enemy.cocooned_resident': 'crab',
  'enemy.drowned_lantern': 'jellyfish',
  'enemy.fissure_sphere': 'orb',
  'enemy.mycelial_drone': 'fungal',
  'enemy.mycelial_queen': 'fungal',
  'enemy.corpse_wearer': 'humanoid',
};

export function enemySilhouette(defId: string): EnemySilhouette {
  return ENEMY_SILHOUETTE[defId] ?? 'fish';
}

/** 敌人轮廓线稿。size/color 由外层（EnemyPortrait 的占位圆）传入，纯描边、无填充。 */
export function EnemyGlyph({ defId, size = 22 }: { defId: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      aria-hidden="true"
    >
      {SILHOUETTE_GLYPH[enemySilhouette(defId)]}
    </svg>
  );
}
