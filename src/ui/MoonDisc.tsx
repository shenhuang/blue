// 月相几何盘（almanac 印刷风·纯 UI·无相位计算）。
// 实填 = 受光区域，用 currentColor 继承父元素文字色——在游戏暗色调（#0a1018 底）上自然呈现。
// engine↛ui OK（从 @/types 取类型·不导入 engine/）。
import type { LunarPhase } from '@/types';

interface Props {
  phase: LunarPhase;
  size?: number;
}

/**
 * 小几何月相盘（SVG·viewBox 0 0 24 24·cx=12 cy=12 r=9）。
 *
 * - new    = 空盘（仅描边环）
 * - waxing = 右半满（上弦受光在右）
 * - full   = 满盘
 * - waning = 左半满（下弦受光在左）
 *
 * 填色 = currentColor（从父元素 color 继承）；环描边同色。
 * aria-hidden 或 aria-label 依场景：图标本身无独立语义·由父容器提供文案。
 */
export function MoonDisc({ phase, size = 24 }: Props) {
  const label =
    phase === 'new'
      ? '新月'
      : phase === 'waxing'
        ? '上弦'
        : phase === 'full'
          ? '满月'
          : '下弦';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-label={label}
      role="img"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {/* 外圈：始终显示，描边用 currentColor */}
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />

      {phase === 'full' && (
        // 满月：整圆填充
        <circle cx="12" cy="12" r="9" fill="currentColor" />
      )}

      {phase === 'waxing' && (
        // 上弦：右半圆（受光在右）
        // M12,3 沿右弧到 12,21，再沿直径线回来（sweep-flag=1 = 顺时针）
        <path d="M12,3 A9,9 0 0 1 12,21 Z" fill="currentColor" />
      )}

      {phase === 'waning' && (
        // 下弦：左半圆（受光在左）
        // M12,3 沿左弧到 12,21（sweep-flag=0 = 逆时针）
        <path d="M12,3 A9,9 0 0 0 12,21 Z" fill="currentColor" />
      )}

      {/* new: 无填充路径——仅靠外圈描边表示空盘 */}
    </svg>
  );
}
