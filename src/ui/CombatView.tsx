import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { GameState, EnemyInstance, CombatAction } from '@/types';
import { applyPlayerAction, listAvailableActions, getEnemyDef } from '@/engine/combat';
import { frontmostLivingSegment } from '@/engine/chain-eel';
import { beginAscent } from '@/engine/transitions';
import { isAscentBlocked } from '@/engine/ascent';
import { StatusBar } from './StatusBar';
import { EnemyPortrait } from './EnemyPortrait';
import { ActionIcon } from './actionIcons';

interface Props {
  state: GameState;
  onStateChange: (s: GameState) => void;
}

export function CombatView({ state, onStateChange }: Props) {
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  // 日志固定高度+内部滚动（见 styles.css .combat-log）：新行进来自动贴底，
  // 不再靠 slice(-5) 截断来防止撑开外层排版——这是真正修容器高度、不是砍内容。
  const combatLogLength = state.phase.kind === 'combat' ? state.phase.combat.log.length : 0;
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [combatLogLength]);

  if (state.phase.kind !== 'combat' || !state.run) return null;
  const combat = state.phase.combat;
  const aliveEnemies = combat.enemies.filter((e) => e.hp > 0);
  const actions = listAvailableActions(state);
  // 封闭水域离开上浮口（头上是岩顶）→ 战斗里不给紧急上浮：脱离只能靠 flee 再摸回上浮口。
  // 开阔水 / 在上浮口才保留紧急上浮（也是高氮的死亡出口）。见氮气 SPEC §4。
  const ascentBlocked = isAscentBlocked(state.run);

  // 链鳗（分节实体）按序门：attackInOrder 遭遇里玩家只能打**最前存活节**，后节被前节挡着（不可选）。
  // 缺省（非按序遭遇）→ attackInOrder=false ⇒ 目标可自由选、逐字节不变（守既有战斗 UI）。
  const attackInOrder = combat.attackInOrder === true;
  const frontSeg = frontmostLivingSegment(combat.enemies);

  // 目标锁定：按序遭遇强制锁最前存活节（与引擎 applyAttack 同口径）；否则保留「选中的活敌·缺省首个活敌」。
  const currentTarget = attackInOrder
    ? frontSeg
    : aliveEnemies.find((e) => e.instanceId === selectedTarget) ?? aliveEnemies[0];

  function handleAction(action: CombatAction) {
    const target = action.targeting === 'single' ? currentTarget?.instanceId : undefined;
    const result = applyPlayerAction(state, action.id, target);
    onStateChange(result.state);
  }

  // 弃战上浮：转身向上脱离战斗 → 进上浮屏（带 duress·正被咬着 ⇒ resolveAscent 否决干净上浮·SPEC §5）。
  // 不在这里二次确认——上浮屏的单按钮按状态自决（危急/致命才弹确认·避免双重确认 + 文案打架）。
  function handleEmergencyAscent() {
    onStateChange(beginAscent(state, undefined, { duress: true }));
  }

  return (
    <div className="dive combat">
      {/* 左栏（桌面双栏）/ 钉顶（手机）：战斗中状态栏锁定不随滚动（作者：状态挪到事件上方·只滑下面内容）。
          用 .dive-pinned（同事件栏机制）：桌面进 .app-dive 网格左列；手机 sticky 钉顶。不带 .dive-header＝无抽屉。 */}
      <div className="dive-pinned">
        <StatusBar run={state.run} />
      </div>

      <div className="combat-main">
      <div className="combat-enemies">
        <h3>敌人</h3>
        {combat.enemies.length === 0 && <div className="dim">（空）</div>}
        <div className="enemy-grid">
          {combat.enemies.map((e) => {
            // 链鳗：活着但不是最前存活节 → 被挡住（不可选·给提示）；非按序遭遇恒可达。
            const reachable = !attackInOrder || e.instanceId === frontSeg?.instanceId;
            return (
              <EnemyCard
                key={e.instanceId}
                enemy={e}
                selected={currentTarget?.instanceId === e.instanceId}
                reachable={reachable}
                onSelect={() => reachable && setSelectedTarget(e.instanceId)}
              />
            );
          })}
        </div>
        {combat.enemies.length > 3 && (
          <div className="dim enemy-scroll-hint">← 左右滑动查看全部敌人 →</div>
        )}
      </div>

      <div className="combat-log" ref={logRef}>
        {combat.log.map((l, i) => (
          <div key={i} className={`log-line log-${l.actor}`}>
            {l.text}
          </div>
        ))}
      </div>

      <div className="combat-actions">
        <h3>你的行动</h3>
        <ul className="event-options">
          {actions.map(({ action, availability }) => (
            <li key={action.id}>
              <button
                className={`btn event-option ${!availability.available ? 'disabled' : ''}`}
                onClick={() => availability.available && handleAction(action)}
                disabled={!availability.available}
                title={action.description}
              >
                <div className="action-row">
                  <span className="action-name">
                    <ActionIcon action={action} />
                    {action.name}
                  </span>
                  <span className="action-cost">
                    {action.costStamina > 0 && `体力 -${action.costStamina} `}
                    {action.costOxygenTurns > 0 && `氧气 -${action.costOxygenTurns}`}
                  </span>
                </div>
                <div className="action-desc dim">
                  {action.description}
                  {!availability.available && availability.reason && (
                    <span className="warn"> · {availability.reason}</span>
                  )}
                </div>
              </button>
            </li>
          ))}
          {!ascentBlocked && (
            <li>
              <button className="btn event-option danger" onClick={handleEmergencyAscent}>
                ↑ 上浮（弃战脱离）
              </button>
            </li>
          )}
        </ul>
      </div>
      </div>
    </div>
  );
}

function EnemyCard({
  enemy,
  selected,
  reachable,
  onSelect,
}: {
  enemy: EnemyInstance;
  selected: boolean;
  reachable: boolean;
  onSelect: () => void;
}) {
  const def = getEnemyDef(enemy.defId);
  if (!def) return null;
  const hpPct = Math.max(0, (enemy.hp / def.hp) * 100);
  const dead = enemy.hp <= 0;
  // 链鳗：活着但被前节挡住——不可选·禁用按钮·给提示（与引擎 checkActionAvailability 的 reason 同口径）。
  const blocked = !dead && !reachable;
  return (
    <button
      className={`enemy-card ${selected ? 'selected' : ''} ${dead ? 'dead' : ''} ${blocked ? 'blocked' : ''}`}
      onClick={onSelect}
      disabled={dead || blocked}
      title={blocked ? '够不到——它身前还有节段挡着，先清掉最前面的。' : undefined}
    >
      {/* 手机（≤480px·styles.css 同断点）：名字/姿态隐藏、血条改画成头像四周的圆环——
          --hp-pct 只是喂给圆环 conic-gradient 的变量，宽屏下这条变量没人读、零视觉影响。 */}
      <div className="enemy-portrait-ring" style={{ '--hp-pct': `${hpPct}%` } as CSSProperties}>
        <EnemyPortrait def={def} size={40} />
      </div>
      <div className="enemy-card-body">
        <div className="enemy-name">
          <span>
            {def.name}
            {blocked && <span className="enemy-blocked-hint"> · 被前节挡住</span>}
          </span>
          <span className={`stance stance-${enemy.stance}`}>
            {stanceLabel(enemy.stance)}
          </span>
        </div>
        <div className="enemy-hp">
          <div className="hp-bar">
            <div className="hp-fill" style={{ width: `${hpPct}%` }} />
          </div>
          <span className="hp-text">
            {enemy.hp} / {def.hp}
          </span>
        </div>
      </div>
    </button>
  );
}

function stanceLabel(stance: string): string {
  switch (stance) {
    case 'unaware': return '未察觉';
    case 'alerted': return '警戒';
    case 'attacking': return '攻击中';
    case 'enraged': return '狂暴';
    case 'fleeing': return '逃跑';
    default: return stance;
  }
}
