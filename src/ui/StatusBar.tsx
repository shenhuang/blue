import type { RunState } from '@/types';
import { computeRequiredStops } from '@/engine/ascent';

interface Props {
  run: RunState;
}

export function StatusBar({ run }: Props) {
  const { stats, currentDepth, oxygenMax } = run;
  // 负伤系统整套下线（战斗系统改版 2026-07-10）：体力上限恒 run.staminaMax（无负伤折算）。
  const staminaMax = run.staminaMax;
  const depthFactor = 1 + currentDepth / 50;
  const remainingOxygenTurns = Math.floor(stats.oxygen / depthFactor);

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
        {/* 生命值（战斗系统改版 2026-07-10）：伤害落点·归零死·潜内持久。放首位＝生存主轴。 */}
        <StatPill label="生命" value={stats.hp} max={run.hpMax} tint="red" />
        <StatPill label="体力" value={stats.stamina} max={staminaMax} tint="green" />
        <StatPill label="氧气" value={stats.oxygen} max={oxygenMax} tint="cyan" suffix=" 回合" />
        <StatPill label="氮气" value={stats.nitrogen} max={100} tint="yellow" invert />
        <StatPill label="电量" value={run.power} max={run.powerMax} tint="amber" />
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
  tint: 'green' | 'cyan' | 'yellow' | 'amber' | 'red';
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
