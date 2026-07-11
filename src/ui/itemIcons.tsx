// 全道具图标（**占位线稿**·2026-06-28·作者验收「先这样·只是 placeholder」）。
//
// 单一来源 + 分层解析：ItemIcon 只要 id 就能出图，解析顺序——
//   1. 专属 glyph（GLYPH[id]·63 件已逐件画）
//   2. 装备槽兜底（SLOT_GLYPH·按 equipment.slot）
//   3. 材料 role 兜底（ROLE_GLYPH）/ 类目兜底（CAT_GLYPH）
//   ⇒ 新加道具自动有兜底图、零改动；要专属图只往 GLYPH 加一条。
//
// **小图标 vs 大图（作者 2026-06-28 拍）**：小图标＝这里的 SVG glyph（无限缩放·列表/格子用）；
//   未来的「大图」是**另一套更高分辨率的美术资源**，挂在 ART[id]（现为空）。大尺寸消费方（将来的物品详情大图位）
//   命中 ART 就用高清图、否则回退缩放 glyph。换真图＝只动 ART / GLYPH 这一处，界面调用方不变。
//
// 颜色＝类目/role（与作者验收过的画廊一致）：随组件走（tintFor·currentColor），CSS 只管居中/尺寸。
// 守门：scripts/check-material-icons.mjs 校验 GLYPH 每个 key 都是真实 item id（防改名/删除后悬空）。

import type { ReactNode } from 'react';
import type { ItemDef, ItemCategory, MaterialRole, EquipmentSlot } from '@/types';
import { getItemDef } from '@/engine/items';

// ── 专属占位 glyph（inner SVG·stroke=currentColor·viewBox 0 0 24）──────────────
const GLYPH: Record<string, ReactNode> = {
  // 装备
  'item.dive_knife.standard': (<><path d="M3 21l9-9"/><path d="M12 12l6-6 3 3-9 5z"/><path d="M9 12l3 3"/></>),
  'item.rock_drill': (<><path d="M10 3h4v5l-2 1-2-1z"/><path d="M11 9v8l1 4 1-4V9"/></>),
  'item.weapon.rescue_axe': (<><path d="M13 5 7 21"/><path d="M13 5c3-1 6 0 6 3s-3 3-6 2"/></>),
  'item.weapon.pneumatic_pistol': (<><path d="M4 8h10v3h-3l-3 4H6v-4H4z"/><path d="M7 11v4"/></>),
  'item.weapon.harpoon_rifle': (<><path d="M3 10h13"/><path d="M16 10l5-3"/><path d="M16 10l5 3"/><path d="M6 10v3h2"/></>),
  'item.shield.basic': (<><path d="M12 3 19 6v5c0 5-4 8-7 10-3-2-7-5-7-10V6z"/><path d="M12 8v7"/></>),
  'item.tank.bluefin_mk1': (<><rect x="8" y="6" width="8" height="14" rx="4"/><path d="M10 6V4h4v2"/><path d="M15 9h3"/></>),
  'item.suit.thermal_basic': (<path d="M9 4 6 7v3l2-1v9h8v-9l2 1V7l-3-3-2 2h-2z"/>),
  'item.suit.reinforced': (<><path d="M9 4 6 7v3l2-1v9h8v-9l2 1V7l-3-3-2 2h-2z"/><path d="M9 12h6M12 11v6"/></>),
  'item.suit.sound_absorb': (<><path d="M9 4 6 7v3l2-1v9h8v-9l2 1V7l-3-3-2 2h-2z"/><path d="M10 13c1 1 1 2 0 3M14 13c-1 1-1 2 0 3"/></>),
  'item.suit.camo': (<><path d="M9 4 6 7v3l2-1v9h8v-9l2 1V7l-3-3-2 2h-2z"/><path d="M10 11h.6M13 13h.6M11 15h.6"/></>),
  'item.light.hand_torch': (<><path d="M4 9h7l4-2v10l-4-2H4z"/><path d="M15 10h4M15 14h3"/></>),
  'item.light.spotlight': (<><rect x="8" y="3" width="8" height="5" rx="1"/><path d="M8 8 5 21M16 8l3 13"/></>),
  'item.light.floodlamp': (<><rect x="4" y="6" width="16" height="6" rx="1"/><path d="M7 12v5M12 12v5M17 12v5"/><path d="M6 9h2M11 9h2M16 9h2"/></>),
  'item.light.eco_lamp': (<><path d="M9 17h6M10 20h4"/><path d="M12 3a6 6 0 0 0-3 11h6a6 6 0 0 0-3-11z"/><path d="M12 14c0-2 1-3 3-3"/></>),
  'item.sonar.handheld': (<><circle cx="6" cy="12" r="1.6"/><path d="M10 8a6 6 0 0 1 0 8"/><path d="M13 5a10 10 0 0 1 0 14"/></>),
  'item.charm.quiet_pendant': (<><path d="M9 4h6M11 4l1 4 1-4"/><circle cx="12" cy="13" r="5"/><path d="M10 13h4"/></>),
  'item.charm.spare_cell': (<><rect x="5" y="8" width="12" height="8" rx="1"/><path d="M17 10v4"/><path d="M8 12h2M9 11v2M13 12h2"/></>),
  // 消耗
  'item.med_kit': (<><rect x="4" y="6" width="16" height="12" rx="2"/><path d="M12 9v6M9 12h6"/></>),
  'item.decoy_sound': (<><path d="M4 10h3l4-3v10l-4-3H4z"/><path d="M14 9a4 4 0 0 1 0 6M16 7a7 7 0 0 1 0 10"/></>),
  'item.decoy_light': (<><rect x="9" y="3" width="6" height="18" rx="3"/><path d="M9 9h6"/><path d="M12 6v.4"/></>),
  'item.ammo.pneumatic': (<><path d="M9 4h6v8l-3 3-3-3z"/><path d="M9 8h6M9 12h6"/></>),
  'item.ammo.harpoon': (<><path d="M12 3v13"/><path d="M9 7l3-4 3 4"/><path d="M9 16h6l-3 5z"/></>),
  // 武器改装
  'item.mod.poison_sac': (<><path d="M12 4c3 4 5 6 5 9a5 5 0 0 1-10 0c0-3 2-5 5-9z"/><path d="M10 13h4"/></>),
  'item.mod.barb_kit': (<><path d="M6 18 18 6"/><path d="M13 6h5v5"/><path d="M12 12l-2 1M14 10l1-2"/></>),
  'item.mod.silent_wrap': (<><path d="M4 10h3l4-3v10l-4-3H4z"/><path d="M15 9l5 6M20 9l-5 6"/></>),
  'item.mod.shock_core': (<><circle cx="12" cy="12" r="7"/><path d="M13 7l-3 6h3l-1 4 3-6h-3z"/></>),
  // 剧情
  'item.old_chart': (<><path d="M4 6 9 4l6 2 5-2v14l-5 2-6-2-5 2z"/><path d="M9 4v14M15 6v14"/></>),
  'item.captain_log': (<><path d="M6 4h11v16H8a2 2 0 0 1-2-2z"/><path d="M9 4v14"/></>),
  'item.mentor_logbook': (<><path d="M6 5h6v14H8a2 2 0 0 1-2-2z"/><path d="M12 5v14"/><path d="M14 8l3 1-3 1M14 12l3 1-3 1"/></>),
  'item.ch1.steadying_charm_broken': (<><path d="M9 4h6M12 4v4"/><circle cx="12" cy="13" r="5"/><path d="M12 9l-2 4 3 1-1 3"/></>),
  'item.rusty_compass': (<><circle cx="12" cy="12" r="8"/><path d="M12 12 15 9l-2 6-4 1z"/></>),
  'item.brass_pocket_watch': (<><circle cx="12" cy="13" r="6"/><path d="M12 13V9.5M12 13l3 1.5"/><path d="M12 4v3M10 4h4"/></>),
  'item.waterlogged_logbook': (<><path d="M6 4h11v16H8a2 2 0 0 1-2-2z"/><path d="M9 4v14"/><path d="M13 16c0-1.5 2-3 2-3s2 1.5 2 3a2 2 0 0 1-4 0z"/></>),
  // 其它
  'item.note.sonar_checklist': (<><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h7M9 12h7M9 16h4"/><path d="M6.4 8l.6.6 1-1"/></>),
  // 材料
  'item.shark_tooth': (<path d="M5 5c3.2 8.4 4.2 12 7 14 2.8-2 3.8-5.6 7-14-4.8 2-9.2 2-14 0Z"/>),
  'item.coral_shard': (<><path d="M12 21v-7M12 14c0-2.6-2.7-2.9-2.7-5.6M12 14c0-2.6 2.7-2.9 2.7-5.6"/><circle cx="9.3" cy="7.4" r="1.4"/><circle cx="14.7" cy="7.4" r="1.4"/><circle cx="12" cy="6.2" r="1.4"/></>),
  'item.scrap_alloy': (<><path d="M12 3 20 7.5v9L12 21 4 16.5v-9L12 3Z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/></>),
  'item.lobster': (<><path d="M12 9c-2.8 0-4.6 2.1-4.6 4.8S9.2 21 12 21s4.6-4.5 4.6-7.2S14.8 9 12 9Z"/><path d="M12 9V4M9.4 6.4 7 4M14.6 6.4 17 4"/></>),
  'item.canned_food': (<><path d="M7 7v11a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7"/><ellipse cx="12" cy="7" rx="5" ry="2"/><path d="M9 11h6"/></>),
  'item.old_fishing_net': (<><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/></>),
  'item.eel_skin': (<><path d="M4 14c3-4 5 1 8-1s4-6 8-5"/><circle cx="5.5" cy="13" r="0.8"/></>),
  'item.crab_chitin': (<><path d="M7 13a5 4 0 0 1 10 0z"/><path d="M5 11l2 1M19 11l-2 1M8 16l-2 3M16 16l2 3M10 16l-1 3M14 16l1 3"/></>),
  'item.brass_fitting': (<><circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.5M12 18v2.5M3.5 12h2.5M18 12h2.5M6 6l1.8 1.8M16.2 16.2 18 18M18 6l-1.8 1.8M7.8 16.2 6 18"/></>),
  'item.barracuda_jaw': (<><path d="M4 8c5 3 11 3 16 0"/><path d="M6 8l1 3M9.5 9l1 3.5M13.5 9l-1 3.5M18 8l-1 3"/></>),
  'item.cave_octopus_beak': (<><path d="M8 4c1 5 2 9 4 13 2-4 3-8 4-13"/><path d="M8 4c4-1 4-1 8 0"/></>),
  'item.lantern_gland': (<><circle cx="12" cy="12" r="4.5"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/></>),
  'item.grouper_maw': (<><path d="M3 12c3-4 9-4 13 0-4 4-10 4-13 0z"/><circle cx="13" cy="11" r="1"/><path d="M16 12l5-3v6z"/></>),
  'item.quartz_crystal': (<><path d="M12 3 16 9l-4 12-4-12z"/><path d="M8 9h8"/></>),
  'item.flint_nodule': (<path d="M7 8l5-3 5 4-1 7-6 1-4-4z"/>),
  'item.manganese_nodule': (<><circle cx="12" cy="12" r="7"/><path d="M9 9a4 4 0 0 1 5 1M9 14a4 4 0 0 0 6 0"/></>),
  'item.iron_concretion': (<><circle cx="12" cy="12" r="7"/><path d="M8 11h2M13 9h2M11 15h3"/></>),
  'item.vent_sulfide': (<><path d="M9 21V9l3-4 3 4v12"/><path d="M9 13h6"/><path d="M12 5V3"/></>),
  'item.abyssal_crust': (<><path d="M4 12c3-2 6-2 8 0s5 2 8 0"/><path d="M4 16c3-2 6-2 8 0s5 2 8 0"/></>),
  'item.bluecave_geode': (<><path d="M6 10l6-5 6 5-6 9z"/><path d="M9 9l3 3 3-3M12 12v5"/></>),
  'item.gallery_crust': (<><path d="M4 14c2-3 5-1 8-2s5 1 8-1"/><path d="M5 17h14"/></>),
  'item.wreck_bronze': (<><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/><path d="M12 5v2M12 17v2M5 12h2M17 12h2"/></>),
  'item.collapse_fitting': (<><path d="M4 18l5-7 4 2 4-7"/><path d="M4 18h14"/><path d="M14 6h4v4"/></>),
  'item.oyster_shell': (<><path d="M12 18C7 18 4 14 4 10c4 0 8 1 8 8z"/><path d="M12 18c5 0 8-4 8-8-4 0-8 1-8 8z"/></>),
};

// ── 兜底 glyph（新道具没专属图时按槽/类目/role 出图）─────────────────────────
const SLOT_GLYPH: Partial<Record<EquipmentSlot, ReactNode>> = {
  tool: (<><path d="M3 21l9-9"/><path d="M12 12l6-6 3 3-9 5z"/></>),
  ranged: (<><circle cx="12" cy="12" r="7"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></>),
  tank: (<><rect x="8" y="6" width="8" height="14" rx="4"/><path d="M10 6V4h4v2"/></>),
  suit: (<path d="M9 4 6 7v3l2-1v9h8v-9l2 1V7l-3-3-2 2h-2z"/>),
  light: (<><path d="M9 17h6M10 20h4"/><path d="M12 3a6 6 0 0 0-3 11h6a6 6 0 0 0-3-11z"/></>),
  sonar: (<><circle cx="6" cy="12" r="1.6"/><path d="M10 8a6 6 0 0 1 0 8"/><path d="M13 5a10 10 0 0 1 0 14"/></>),
  charm: (<><path d="M9 4h6M11 4l1 4 1-4"/><circle cx="12" cy="13" r="5"/></>),
  charm2: (<><path d="M9 4h6M11 4l1 4 1-4"/><circle cx="12" cy="13" r="5"/></>),
  charm3: (<><path d="M9 4h6M11 4l1 4 1-4"/><circle cx="12" cy="13" r="5"/></>),
};

const ROLE_GLYPH: Record<MaterialRole, ReactNode> = {
  organic: (<><path d="M5 19c8 1 13-4 13-13 0 0-9-1-12 4-2.2 3.5-1 9-1 9z"/><path d="M5 19c2.5-5.5 6-8 10-10"/></>),
  structural: (<><path d="M12 3 20 7.5v9L12 21 4 16.5v-9L12 3Z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/></>),
  optic: (<><path d="M9 17h6M10 20h4"/><path d="M12 3a6 6 0 0 0-3 11h6a6 6 0 0 0-3-11z"/></>),
  special: (<path d="M12 3.2 14.4 9l6.3.4-4.8 4 1.5 6.1L12 16.4 6.6 19.5l1.5-6.1-4.8-4L9.6 9Z"/>),
};

const CAT_GLYPH: Record<ItemCategory, ReactNode> = {
  equipment: (<><rect x="4" y="7" width="16" height="11" rx="2"/><path d="M9 7V5h6v2"/></>),
  consumable: (<path d="M10 3h4M11 3v5l-4 8a2 2 0 0 0 2 3h6a2 2 0 0 0 2-3l-4-8V3"/>),
  material: (<><path d="M12 3 20 7.5v9L12 21 4 16.5v-9L12 3Z"/><path d="M4 7.5 12 12l8-4.5"/></>),
  story: (<><path d="M7 4h10v13a3 3 0 0 1-3 3H7"/><path d="M7 20a3 3 0 0 1-3-3h6"/></>),
  weaponMod: (<><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/></>),
  other: (<><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></>),
  currency: (<><circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 9.5h3a2 2 0 0 1 0 4H10"/></>),
};

// 未来高分辨率「大图」资源（现为空）：itemId → 资源 URL。命中则大尺寸位用高清图、否则回退缩放 glyph。
const ART: Record<string, string> = {};

// 颜色＝类目/role（与画廊一致·随组件走）。
function tintFor(def?: ItemDef): string {
  if (!def) return 'var(--text-muted)';
  if (def.category === 'material') {
    switch (def.role) {
      case 'structural': return '#7fa8c9';
      case 'optic': return 'var(--violet)';
      case 'special': return 'var(--yellow)';
      default: return 'var(--green)';
    }
  }
  switch (def.category) {
    case 'equipment': return 'var(--accent)';
    case 'consumable': return 'var(--green)';
    case 'weaponMod': return 'var(--danger)';
    case 'story': return 'var(--warn)';
    case 'currency': return 'var(--yellow)';
    default: return 'var(--text-muted)';
  }
}

function glyphFor(id: string, def?: ItemDef): ReactNode {
  return (
    GLYPH[id] ??
    (def?.equipment?.slot ? SLOT_GLYPH[def.equipment.slot] : undefined) ??
    (def?.category === 'material' ? ROLE_GLYPH[def.role ?? 'organic'] : undefined) ??
    (def?.category ? CAT_GLYPH[def.category] : undefined) ??
    CAT_GLYPH.other
  );
}

/**
 * 道具图标。只需 id；传了 def 可省一次查表。size 缺省由 CSS 决定（列表/格子各自定）。
 * 小尺寸＝占位 glyph；将来 ART[id] 有高清大图时大尺寸位自动改用之（见文件头）。
 */
export function ItemIcon({ id, def, size }: { id: string; def?: ItemDef; size?: number }): JSX.Element {
  const d = def ?? getItemDef(id);
  const art = ART[id];
  const dim = size ? { width: size, height: size } : undefined;
  if (art) {
    return <img className="item-art" src={art} alt="" aria-hidden="true" style={dim} />;
  }
  return (
    <svg
      className="item-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ color: tintFor(d), ...dim }}
    >
      {glyphFor(id, d)}
    </svg>
  );
}

/** 兼容旧引用（潜点「可能收获」chip 用·见 SeaChartView）：等价于 ItemIcon。 */
export function MaterialIcon({ id }: { id: string; role?: MaterialRole }): JSX.Element {
  return <ItemIcon id={id} />;
}
