import type { RunState } from '@/types';

interface Props {
  run: RunState;
}

export function StatusBar({ run }: Props) {
  const { stats, currentDepth, staminaMax, oxygenMax } = run;
  const depthFactor = 1 + currentDepth / 50;
  const remainingOxygenTurns = Math.floor(stats.oxygen / depthFactor);

  // 估算上浮安全所需的最小回合数（占位：每 10m 需 1 个减压停留，30m 以下不需要）
  const stopsNeeded =
    stats.nitrogen < 40
      ? 0
      : stats.nitrogen < 60
        ? 1
        : stats.nitrogen < 80
          ? 2
          : 3;
  const ascentTurns = Math.ceil(currentDepth / 5) + stopsNeeded;

  const overstayed = remainingOxygenTurns < ascentTurns;

  return (
    <div className="status-bar">
      <div className="status-row">
        <span className="depth">深度 {currentDepth}m</span>
        <span className="turn">回合 {run.turn}</span>
        <span className="gold">金币 {run.gold}</span>
      </div>
      <div className="status-stats">
        <StatPill label="体力" value={stats.stamina} max={staminaMax} tint="green" />
        <StatPill label="氧气" value={stats.oxygen} max={oxygenMax} tint="cyan" suffix=" 回合" />
        <StatPill label="氮气" value={stats.nitrogen} max={100} tint="yellow" invert />
        <StatPill label="理智" value={stats.sanity} max={100} tint="violet" />
      </div>
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
  tint: 'green' | 'cyan' | 'yellow' | 'violet';
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
