import { useState } from 'react';
import type { RunState } from '@/types';
import { describeInjury, type InjuryBadge } from '@/engine/injuries';
import { effectiveStaminaMax } from '@/engine/modifiers';
import { computeRequiredStops } from '@/engine/ascent';

interface Props {
  run: RunState;
}

export function StatusBar({ run }: Props) {
  const { stats, currentDepth, oxygenMax } = run;
  // 体力上限走负伤折算（负伤 SPEC §9 徽章诚实：条轨上限与引擎结算同源，不显示虚假余量）
  const staminaMax = effectiveStaminaMax(run);
  const depthFactor = 1 + currentDepth / 50;
  const remainingOxygenTurns = Math.floor(stats.oxygen / depthFactor);

  // 伤势徽章三件套（负伤 SPEC §9：档位 + 生效效果 + 治疗路径·点开看详情）
  const badges = run.injuries
    .map(describeInjury)
    .filter((b): b is InjuryBadge => b !== null);
  const [openInjuryId, setOpenInjuryId] = useState<string | null>(null);
  const openBadge = badges.find((b) => b.defId === openInjuryId) ?? null;

  // 上浮安全所需最小回合数：减压停留数走 computeRequiredStops（与上浮屏 / 减压病判定同源·同读 N2 阈值·
  // 不再本地复刻 40/60/80 那串会漂移的字面量·氮气 SPEC）。
  const stopsNeeded = computeRequiredStops(stats.nitrogen);
  const ascentTurns = Math.ceil(currentDepth / 5) + stopsNeeded;

  const overstayed = remainingOxygenTurns < ascentTurns;

  return (
    <div className="status-bar">
      <div className="status-row">
        <span className="depth">深度 {currentDepth}m</span>
      </div>
      <div className="status-stats">
        <StatPill label="体力" value={stats.stamina} max={staminaMax} tint="green" />
        <StatPill label="氧气" value={stats.oxygen} max={oxygenMax} tint="cyan" suffix=" 回合" />
        <StatPill label="氮气" value={stats.nitrogen} max={100} tint="yellow" invert />
        <StatPill label="电量" value={run.power} max={run.powerMax} tint="amber" />
      </div>
      {badges.length > 0 && (
        <div className="status-injuries">
          {badges.map((b) => (
            <button
              key={b.defId}
              type="button"
              className={`injury-chip tier-${b.tier}${openInjuryId === b.defId ? ' open' : ''}`}
              onClick={() => setOpenInjuryId(openInjuryId === b.defId ? null : b.defId)}
            >
              {b.name}·{b.tierLabel}
            </button>
          ))}
        </div>
      )}
      {openBadge && (
        <div className="injury-detail">
          {openBadge.effectLines.map((line) => (
            <div key={line} className="injury-detail-line">
              {line}
            </div>
          ))}
          <div className="injury-detail-heal">{openBadge.healLine}</div>
        </div>
      )}
      <div className={`status-warn ${overstayed ? 'danger' : ''}`}>
        氧气剩余 {remainingOxygenTurns} 回合 ・ 安全上浮需 {ascentTurns} 回合
        {overstayed && '  ⚠ 已过界'}
      </div>
    </div>
  );
}

interface PillProps {
  label: string;
  value: number;
  max: number;
  tint: 'green' | 'cyan' | 'yellow' | 'amber';
  suffix?: string;
  invert?: boolean;
}

function StatPill({ label, value, max, tint, suffix, invert }: PillProps) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={`stat-pill tint-${tint}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-bar">
        <div
          className={`stat-fill ${invert ? 'invert' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="stat-value">
        {Math.round(value)}
        {suffix ?? ` / ${max}`}
      </div>
    </div>
  );
}
