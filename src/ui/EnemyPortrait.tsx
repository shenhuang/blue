import type { EnemyDef } from '@/types';
import { EnemyGlyph } from './enemyIcons';

// 敌人头像（战斗 UI 卡片用·作者 2026-07-01·2026-07-02 改用形状线稿）。
// 真实立绘走 def.portraitUrl（美术资源路径）——目前敌人库都还没画，缺省时这里生成一个
// **稳定、零维护**的占位头像：按 id 哈希取色（游戏既有配色）+ 按物种轮廓分类的线稿（见 enemyIcons.tsx），
// 不再用名字首字（看着像随手打的字、不像敌人）。新增敌人不需要碰这个文件；
// 补真实立绘也只需在敌人 JSON 上加 portraitUrl，组件侧零改动。

const PLACEHOLDER_COLORS = ['#4ed1c1', '#f3a64a', '#ff6b6b', '#b88dff', '#6fa8dc', '#8bc34a'];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

function placeholderColor(id: string): string {
  return PLACEHOLDER_COLORS[hashString(id) % PLACEHOLDER_COLORS.length];
}

interface Props {
  def: EnemyDef;
  size?: number;
  className?: string;
}

export function EnemyPortrait({ def, size = 40, className }: Props) {
  if (def.portraitUrl) {
    return (
      <img
        src={def.portraitUrl}
        alt={def.name}
        className={`enemy-portrait ${className ?? ''}`}
        style={{ width: size, height: size }}
      />
    );
  }
  const color = placeholderColor(def.id);
  return (
    <div
      className={`enemy-portrait enemy-portrait-placeholder ${className ?? ''}`}
      style={{ width: size, height: size, borderColor: color, color }}
      aria-hidden="true"
    >
      <EnemyGlyph defId={def.id} size={size * 0.55} />
    </div>
  );
}
