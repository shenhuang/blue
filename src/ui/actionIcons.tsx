// 战斗行动图标（占位线稿·作者 2026-07-02）——跟 ui/itemIcons.tsx 同一套画风/同一套解析顺序，
// 不是另起一摊：
//   1. 用物品的行动（requiresItemId，如急救包/诱标）直接复用 ItemIcon——同一件东西没道理画两张图；
//   2. 其余按 action.id 专属 glyph（ACTION_GLYPH）；
//   3. 都没有 → 按 effect.kind 兜底（KIND_GLYPH）——新加行动零改动也有图。
// 颜色按 effect.kind 分组（tintFor）：攻击类暖红、防御青、恢复绿、脱离警橙、控场紫。

import type { ReactNode } from 'react';
import type { CombatAction, ActionEffect } from '@/types';
import { ItemIcon } from './itemIcons';

type EffectKind = ActionEffect['kind'];

const ACTION_GLYPH: Record<string, ReactNode> = {
  'action.knife_slash': (<><path d="M3 21l9-9"/><path d="M12 12l6-6 3 3-9 5z"/><path d="M9 12l3 3"/></>),
  'action.axe_chop': (<><path d="M13 5 7 21"/><path d="M13 5c3-1 6 0 6 3s-3 3-6 2"/></>),
  'action.fire_pneumatic': (<><path d="M4 8h10v3h-3l-3 4H6v-4H4z"/><path d="M7 11v4"/></>),
  'action.fire_harpoon': (<><path d="M3 10h13"/><path d="M16 10l5-3"/><path d="M16 10l5 3"/><path d="M6 10v3h2"/></>),
  'action.fist': (<><rect x="7" y="10" width="10" height="8" rx="3"/><path d="M9 10V7a1 1 0 0 1 2 0v3M12.3 10V6a1 1 0 0 1 2 0v4M15.6 10V7.5a1 1 0 0 1 2 0V10"/><path d="M7 13 4 11"/></>),
  'action.flee': (<><path d="M4 5v14"/><path d="M4 12h13"/><path d="M13 7l5 5-5 5"/></>),
  'action.breathe': (<><circle cx="12" cy="12" r="7"/><path d="M12 8v8M8.5 12h7"/></>),
};

// effect.kind 兜底（新行动没写进 ACTION_GLYPH 时用·同一套 kind 也决定色调）。
const KIND_GLYPH: Record<EffectKind, ReactNode> = {
  attack: ACTION_GLYPH['action.knife_slash'],
  recover: ACTION_GLYPH['action.breathe'],
  flee: ACTION_GLYPH['action.flee'],
  crowd_control: (<><circle cx="12" cy="12" r="6"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4"/></>),
  use_item: (<><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></>),
};

const KIND_TINT: Record<EffectKind, string> = {
  attack: 'var(--danger)',
  recover: 'var(--green)',
  flee: 'var(--warn)',
  crowd_control: 'var(--yellow)',
  use_item: 'var(--text-muted)',
};

interface Props {
  action: CombatAction;
  size?: number;
}

/** 行动图标。用物品的行动直接复用该物品的 ItemIcon（急救包/诱标）；其余按 id/kind 出线稿。 */
export function ActionIcon({ action, size = 18 }: Props) {
  if (action.requiresItemId) {
    return <ItemIcon id={action.requiresItemId} size={size} />;
  }
  const kind = action.effect.kind;
  const glyph = ACTION_GLYPH[action.id] ?? KIND_GLYPH[kind];
  return (
    <svg
      className="action-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ color: KIND_TINT[kind], width: size, height: size }}
    >
      {glyph}
    </svg>
  );
}
