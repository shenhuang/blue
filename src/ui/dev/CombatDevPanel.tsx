// CombatDevPanel —— 战斗 dev 面板（?editor=combat·仅 import.meta.env.DEV 下挂载）。
//
// 2026-07-23 改造：从「战斗回归 Phase 3」基线编辑器（seed/actions/JSON/LS 批处理编排）改成**潜点式战斗测试**
// （对齐 PlaytestPanel·作者拍）——像选潜点一样选对手、选装备，一键真打：
//   左：对手选择——已注册**遭遇**（combat.* 多敌 encounter）+ **单个敌人**（enemyDef）两段。
//   中：对手详情卡（describeEnemy·攻击表/战利品/属性·遭遇则每个 member 一张）。
//   右：逐槽装备下拉（loadoutPicker 单一来源·与潜点共用）+ 重置 + 「▶ 进入战斗」。
//   进入战斗 → 真实 <CombatView> 反应式打（活 RNG·预览态·绝不落存档），全屏接管、可「← 返回配置 / ⟲ 重开」。
//
// 设计：
//   - 造 state 全走引擎单一入口 buildCombatEntryState（combatScenario.ts·别手搓 phase 字面量·check-boundaries 规则二）。
//   - 装备经 loadoutPicker.picksToLoadout → 真实 EquipmentLoadout；战斗对攻击/武器伤/防御的读取都**从 run.equipment 现读**
//     （combat.ts::equipmentUnlocksAction / weaponDamageForSlot / getEquipmentStats().physicalArmor），所选装备即刻生效。
//     另按所选装备派生 staminaMax/oxygenMax 加成（getRunBonuses·同真游戏 dive 起手）喂 bonuses，让上限反映气瓶等。
//   - 复用 dev-panel.css 基底 + combat-panel.css 战斗专属（敌人列表 / 详情卡 / HP 条 / 三栏 grid）。
//
// 移除（基线编辑归 CLI·playthrough-combat + scenarios/·门不受影响）：ad-hoc 勾选构造 / stats·bonuses·wornSkin·
// upgrades·seed·maxTurns·actions[] 表单 / 批处理确定性预览 / JSON 导入导出 / localStorage 存取 / CombatScenarioSerializer。

import { useMemo, useRef, useState, type ReactNode } from 'react';
import './combat-panel.css';
import {
  buildCombatEntryState,
  listAllCombats,
  listAllEnemies,
  describeEnemy,
  type CombatScenarioInput,
  type CombatListEntry,
  type EnemyListEntry,
} from '@/engine/combatScenario';
import { createInitialGameState } from '@/engine/state';
import { getRunBonuses } from '@/engine/lighthouses';
import { frontmostLivingSegment } from '@/engine/chain-eel';
import type { GameState, CombatState, InventoryItem, EnemyDef } from '@/types';
import { EQUIPMENT_SLOTS } from '@/types/items';
// dev → game：实战预览 + 敌人头像复用真实游戏组件（#152 game↛dev 的允许方向·见 check-boundaries 规则五）。
import { CombatView } from '../CombatView';
import { EnemyPortrait } from '../EnemyPortrait';
import {
  SLOT_LABEL,
  DEFAULT_PICKS,
  useEquipmentOptionsBySlot,
  picksToLoadout,
  type EquipmentPicks,
} from './loadoutPicker';

// ---------------------------------------------------------------------------
// 顶层组件
// ---------------------------------------------------------------------------

/** 左栏选中的对手：一场已注册遭遇，或单个敌人 def。 */
type Opponent = { kind: 'combat'; id: string } | { kind: 'enemy'; id: string };

export function CombatDevPanel() {
  // 数据：缓存一次
  const allCombats = useMemo<CombatListEntry[]>(() => listAllCombats(), []);
  const allEnemies = useMemo<EnemyListEntry[]>(() => listAllEnemies(), []);
  const optionsBySlot = useEquipmentOptionsBySlot();

  // 默认对手：有遭遇选第一场·否则第一只敌人（SSR 也确定性）。
  const [opponent, setOpponent] = useState<Opponent>(() =>
    allCombats[0]
      ? { kind: 'combat', id: allCombats[0].id }
      : { kind: 'enemy', id: allEnemies[0]?.id ?? '' },
  );

  // 装备（潜点式逐槽下拉·默认自带匕首 ⇒ 一进战斗就有攻击）。
  const [picks, setPicks] = useState<EquipmentPicks>(() => ({ ...DEFAULT_PICKS }));

  // 实战（live）：buildCombatEntryState 造 combat 相位 state → 喂真实 <CombatView>。
  const [live, setLive] = useState<GameState | null>(null);
  const [liveErrors, setLiveErrors] = useState<string[]>([]);
  const [launchErrors, setLaunchErrors] = useState<string[]>([]);
  const liveEntryRef = useRef<GameState | null>(null); // 进入前快照·loot diff 基线

  // 中栏详情要展示的 def id 列表：遭遇→去重的 party 成员·单敌→它自己。
  const detailDefIds = useMemo<string[]>(() => {
    if (opponent.kind === 'enemy') return opponent.id ? [opponent.id] : [];
    const c = allCombats.find((x) => x.id === opponent.id);
    return c ? Array.from(new Set(c.memberDefIds)) : [];
  }, [opponent, allCombats]);

  // 左栏手风琴：默认只展开当前选中所在的组（同潜点·活跃组高亮 .on·点分类条收起/展开）。
  const [collapsed, setCollapsed] = useState<{ combats: boolean; enemies: boolean }>(() => ({
    combats: opponent.kind !== 'combat',
    enemies: opponent.kind !== 'enemy',
  }));
  const toggleGroup = (g: 'combats' | 'enemies') =>
    setCollapsed((c) => ({ ...c, [g]: !c[g] }));

  // def 取数（左栏头像 + 遭遇显示名共用）：EnemyListEntry 不含 portraitUrl，经 describeEnemy 取全 def。
  const defOf = (id: string | undefined): EnemyDef | undefined =>
    id ? describeEnemy(id)?.def : undefined;
  const oppoIcon = (def: EnemyDef | undefined): ReactNode =>
    def ? <EnemyPortrait def={def} size={30} /> : null;
  // 遭遇显示名＝party 成员中文名（同名折成 ×N）拼接（combat.* 无独立名·由成员派生）。
  const encounterLabel = (c: CombatListEntry): string => {
    const counts = new Map<string, number>();
    for (const id of c.memberDefIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    return Array.from(counts.entries())
      .map(([id, n]) => {
        const nm = describeEnemy(id)?.def.name ?? id;
        return n > 1 ? `${nm} ×${n}` : nm;
      })
      .join(' + ');
  };

  const canLaunch = opponent.id !== '';
  const opponentLabel =
    opponent.kind === 'combat'
      ? opponent.id
      : describeEnemy(opponent.id)?.def.name ?? opponent.id;

  // —— 组装引擎入口输入：所选对手 + 装备（+ 由装备派生的上限加成）——
  function buildInput(): CombatScenarioInput {
    const loadout = picksToLoadout(picks, optionsBySlot);
    // 按所选装备派生随身加成（同真游戏 startDive 的 getRunBonuses 链），取其上限项喂 bonuses——
    // 让气瓶抬 oxygenMax、体力上限件抬 staminaMax；攻击/武器伤/防御另由 run.equipment 现读、无需在此传。
    const derived = getRunBonuses({ ...createInitialGameState().profile, equipment: loadout });
    const bonuses = {
      staminaMaxBonus: derived.staminaMaxBonus,
      oxygenMaxBonus: derived.oxygenMaxBonus,
    };
    return opponent.kind === 'combat'
      ? { combatId: opponent.id, equipment: loadout, bonuses }
      : { enemyDefIds: [opponent.id], equipment: loadout, bonuses };
  }

  function startLive() {
    const entry = buildCombatEntryState(buildInput());
    liveEntryRef.current = entry.resolvedInitialState;
    setLiveErrors(entry.errors);
    setLive(entry.state); // 失败 → null（仍在配置视图·下方 launchErrors 展示）
    setLaunchErrors(entry.state ? [] : entry.errors);
  }
  function exitLive() {
    setLive(null);
    setLiveErrors([]);
  }

  function setPick(slot: (typeof EQUIPMENT_SLOTS)[number], itemId: string | null) {
    setPicks((p) => ({ ...p, [slot]: itemId }));
  }

  // ---------------------------------------------------------------------------
  // 实战全屏接管（对齐 PlaytestPanel 的 launched 视图）
  // ---------------------------------------------------------------------------
  if (live) {
    return (
      <div className="dev-panel">
        <div className="dev-panel-header">
          <div>
            <div className="dev-panel-title">战斗中 · {opponentLabel}</div>
            <div className="dev-panel-sub">真实 CombatView · 活 RNG · 预览态（绝不落存档）</div>
          </div>
          <div className="dev-panel-header-actions">
            <button className="dev-btn" onClick={startLive} title="丢弃当前这局·按最新装备重开">
              ⟲ 重开
            </button>
            <button className="dev-btn dev-btn-quiet" onClick={exitLive}>
              ← 返回配置
            </button>
          </div>
        </div>
        <div className="dev-combat-live-body">
          <LiveCombatPane
            live={live}
            errors={liveErrors}
            entryState={liveEntryRef.current}
            onStateChange={setLive}
            onRestart={startLive}
          />
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // 配置视图（三栏：左 对手 · 中 详情 · 右 装备+开打）
  // ---------------------------------------------------------------------------
  return (
    <div className="dev-panel">
      <div className="dev-panel-header">
        <div>
          <div className="dev-panel-title">战斗 · CombatPanel</div>
          <div className="dev-panel-sub">
            选对手（遭遇 / 单敌）+ 自选装备 → 一键真打（CombatView·活 RNG·预览态）· {allCombats.length} 场遭遇 ·{' '}
            {allEnemies.length} 只敌人 · ?editor=combat
          </div>
        </div>
      </div>

      <div className="dev-panel-body dev-combat-body">
        {/* ——— 左：对手选择（单列表·两收起组·同潜点手风琴） ——— */}
        <div className="dev-col dev-col-form">
          <h3 className="dev-col-title">选择对手</h3>
          <div className="dev-section dev-map-acc">
            <div className="dev-faint" style={{ marginBottom: 6 }}>
              点分类条收起/展开 · 点条目选对手
            </div>

            {/* 遭遇（多敌 encounter） */}
            <div className="dev-map-acc-group">
              <button
                type="button"
                className={`dev-map-acc-head ${opponent.kind === 'combat' ? 'on' : ''}`}
                aria-expanded={!collapsed.combats}
                onClick={() => toggleGroup('combats')}
              >
                <span className="dev-map-acc-chevron">{collapsed.combats ? '▸' : '▾'}</span>
                <span className="dev-map-acc-label">遭遇（多敌）</span>
                <span className="dev-map-acc-hint">{allCombats.length} 场</span>
              </button>
              {!collapsed.combats &&
                (allCombats.length === 0 ? (
                  <p className="dev-faint" style={{ margin: '4px 0 0' }}>
                    （无已注册遭遇）
                  </p>
                ) : (
                  <ul className="dev-event-list dev-map-zone-list">
                    {allCombats.map((c) => (
                      <OpponentRow
                        key={c.id}
                        icon={oppoIcon(defOf(c.memberDefIds[0]))}
                        name={encounterLabel(c)}
                        selected={opponent.kind === 'combat' && opponent.id === c.id}
                        onClick={() => setOpponent({ kind: 'combat', id: c.id })}
                      />
                    ))}
                  </ul>
                ))}
            </div>

            {/* 单个敌人 */}
            <div className="dev-map-acc-group">
              <button
                type="button"
                className={`dev-map-acc-head ${opponent.kind === 'enemy' ? 'on' : ''}`}
                aria-expanded={!collapsed.enemies}
                onClick={() => toggleGroup('enemies')}
              >
                <span className="dev-map-acc-chevron">{collapsed.enemies ? '▸' : '▾'}</span>
                <span className="dev-map-acc-label">单个敌人</span>
                <span className="dev-map-acc-hint">{allEnemies.length} 只</span>
              </button>
              {!collapsed.enemies && (
                <ul className="dev-event-list dev-map-zone-list">
                  {allEnemies.map((e) => (
                    <OpponentRow
                      key={e.id}
                      icon={oppoIcon(defOf(e.id))}
                      name={e.name}
                      selected={opponent.kind === 'enemy' && opponent.id === e.id}
                      onClick={() => setOpponent({ kind: 'enemy', id: e.id })}
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* ——— 中：对手详情卡 ——— */}
        <div className="dev-col dev-col-preview">
          <h3 className="dev-col-title">对手详情</h3>
          {detailDefIds.length === 0 ? (
            <p className="dev-faint">左侧选一个遭遇或敌人。</p>
          ) : (
            detailDefIds.map((id) => <EnemyDetailCard key={id} enemyId={id} />)
          )}
        </div>

        {/* ——— 右：装备 + 开打 ——— */}
        <div className="dev-col dev-combat-loadout-col">
          <h3 className="dev-col-title">
            装备（基础档）
            <button
              className="dev-btn dev-btn-quiet"
              style={{ marginLeft: 10 }}
              onClick={() => setPicks({ ...DEFAULT_PICKS })}
            >
              重置默认
            </button>
          </h3>
          <div className="dev-section">
            {EQUIPMENT_SLOTS.map((slot) => (
              <div key={slot} className="dev-combat-eq-row">
                <span className="dev-combat-eq-label">{SLOT_LABEL[slot]}</span>
                <select
                  value={picks[slot] ?? ''}
                  onChange={(e) => setPick(slot, e.target.value || null)}
                >
                  <option value="">（空）</option>
                  {optionsBySlot[slot].map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {launchErrors.length > 0 && (
            <div className="dev-errors">
              <h4 className="dev-sub-title">无法进入战斗</h4>
              <ul>
                {launchErrors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          <button className="dev-combat-launch" onClick={startLive} disabled={!canLaunch}>
            ▶ 进入战斗
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 对手列表行（头像槽 + 名在上 / id·属性在下·同潜点 zone 行 + 左图标）
// ---------------------------------------------------------------------------

// 只放图标 + 名字——属性/攻击表/战利品这些都在中栏详情卡，左栏保持整齐（作者 2026-07-23）。
function OpponentRow({
  icon,
  name,
  selected,
  onClick,
}: {
  icon: ReactNode;
  name: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <li
      className={`dev-event-item dev-combat-oppo-row ${selected ? 'selected' : ''}`}
      onClick={onClick}
    >
      <span className="dev-combat-row-icon">{icon}</span>
      <div className="dev-combat-row-text">
        <div className="dev-event-id">{name}</div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// 对手详情卡（describeEnemy·纯只读）
// ---------------------------------------------------------------------------

function EnemyDetailCard({ enemyId }: { enemyId: string }) {
  const d = useMemo(() => describeEnemy(enemyId), [enemyId]);
  if (!d) {
    return (
      <div className="dev-combat-describe">
        <h5>{enemyId}</h5>
        <p className="dev-faint">（未注册的 enemyDef）</p>
      </div>
    );
  }
  return (
    <div className="dev-combat-describe">
      <h5>{d.def.name} · 详情</h5>
      <ul>
        <li className="dev-faint">{d.def.id}</li>
        <li>tier={d.def.tier}, ai={d.def.aiPattern}, stance={d.def.initialStance}</li>
        <li>hp={d.def.hp}, defense={d.def.defense}, threat={d.def.threat}</li>
        <li>flee: {d.fleeThresholdDescription}</li>
        <li>victory: [{d.victoryConditions.join(', ')}]</li>
      </ul>
      <h5>攻击表</h5>
      <ul>
        {d.attackSummary.map((a) => (
          <li key={a.id}>
            <strong>{a.name}</strong> ({a.id}) · {a.damageType} dmg={a.damage[0]}-{a.damage[1]}, w=
            {a.weight}
          </li>
        ))}
      </ul>
      <h5>战利品</h5>
      <ul>
        {d.loot.guaranteed.map((l, i) => (
          <li key={`g${i}`}>
            guaranteed: {l.itemId} ×{l.qty[0]}-{l.qty[1]}
          </li>
        ))}
        {d.loot.rolls.map((l, i) => (
          <li key={`r${i}`}>
            roll: {l.itemId} ×{l.qty[0]}-{l.qty[1]} (w={l.weight})
          </li>
        ))}
        <li>rollCount: {d.loot.rollCount}</li>
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 战场压力工具（实战 HUD 用）
// ---------------------------------------------------------------------------

interface EnvPressureAgg {
  oxygenDrainBonus: number;
  staminaTickBonus: number;
}

/** 把一组 defId 的 environmentalPressure 累加（caller 决定喂「存活实例」）。无压力 → null。 */
function sumEnvPressure(defIds: string[]): EnvPressureAgg | null {
  let oxygenDrainBonus = 0;
  let staminaTickBonus = 0;
  let any = false;
  for (const id of defIds) {
    const ep = describeEnemy(id)?.def.environmentalPressure;
    if (!ep) continue;
    any = true;
    oxygenDrainBonus += ep.oxygenDrainBonus ?? 0;
    staminaTickBonus += ep.staminaTickBonus ?? 0;
  }
  return any ? { oxygenDrainBonus, staminaTickBonus } : null;
}

function envPressureText(p: EnvPressureAgg): string {
  const parts: string[] = [];
  if (p.oxygenDrainBonus) parts.push(`氧气 -${p.oxygenDrainBonus}`);
  if (p.staminaTickBonus) parts.push(`体力 -${p.staminaTickBonus}`);
  return parts.join(' · ') || '无';
}

/** loot diff（实战结束卡用·只读 UI 侧两份 inventory）。 */
function diffInventorySimple(before: InventoryItem[], after: InventoryItem[]): InventoryItem[] {
  const beforeMap = new Map(before.map((i) => [i.itemId, i.qty]));
  const out: InventoryItem[] = [];
  for (const item of after) {
    const delta = item.qty - (beforeMap.get(item.itemId) ?? 0);
    if (delta > 0) out.push({ itemId: item.itemId, qty: delta });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 实战（live）—— 真实 <CombatView> 反应式打 + boss 阶段/战场压力/按序 HUD
// ---------------------------------------------------------------------------

interface LiveCombatPaneProps {
  live: GameState | null;
  errors: string[];
  entryState: GameState | null;
  onStateChange: (s: GameState) => void;
  onRestart: () => void;
}

function LiveCombatPane({ live, errors, entryState, onStateChange, onRestart }: LiveCombatPaneProps) {
  if (!live) {
    return (
      <div className="dev-live">
        {errors.length > 0 ? (
          <div className="dev-errors">
            <h4 className="dev-sub-title">无法进入实战</h4>
            <ul>
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
            <p className="dev-faint">改完装备后点顶部「⟲ 重开」重试。</p>
          </div>
        ) : (
          <p className="dev-faint">点「▶ 进入战斗」用当前装备开战。</p>
        )}
      </div>
    );
  }

  // 终局（victory/defeat/flee/ascend → phase 已非 combat）：CombatView 自身会返 null，这里给收尾卡。
  if (live.phase.kind !== 'combat') {
    return (
      <div className="dev-live">
        <LiveTerminalCard live={live} entryState={entryState} onRestart={onRestart} />
      </div>
    );
  }

  return (
    <div className="dev-live">
      <LiveCombatStatus combat={live.phase.combat} />
      <div className="dev-live-combat">
        <CombatView state={live} onStateChange={onStateChange} />
      </div>
    </div>
  );
}

/** 实战中 HUD：boss 阶段（bossPhaseIndices）+ 战场压力（活敌叠加）+ 链鳗按序（最前存活节）。 */
function LiveCombatStatus({ combat }: { combat: CombatState }) {
  // 变量名 enemiesAlive（非 aliveEnemies）：战场压力**只算存活敌人**是 check-dev-panels ② 焊住的不变量，
  // 门用正则匹配 `enemiesAlive.map((e) => e.defId)`——别改成 enemiesFinal（含已死）会虚报。
  const enemiesAlive = combat.enemies.filter((e) => e.hp > 0);

  const bossLines = combat.enemies
    .map((e) => {
      const def = describeEnemy(e.defId)?.def;
      const phaseCount = def?.phases?.length ?? 0;
      if (phaseCount === 0) return null;
      return {
        name: def?.name ?? e.defId,
        idx: combat.bossPhaseIndices?.[e.instanceId] ?? -1,
        phaseCount,
        dead: e.hp <= 0,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const env = sumEnvPressure(enemiesAlive.map((e) => e.defId));

  const front = combat.attackInOrder ? frontmostLivingSegment(combat.enemies) : undefined;
  const frontIdx = front ? combat.enemies.findIndex((e) => e.instanceId === front.instanceId) : -1;

  if (bossLines.length === 0 && !env && !combat.attackInOrder) return null;

  return (
    <div className="dev-live-status">
      {bossLines.map((b, i) => (
        <div key={i} className="dev-live-status-line">
          <span className="dev-combat-phase-badge">
            阶段 {b.idx + 1}/{b.phaseCount}
          </span>
          <span>
            {b.name}
            {b.dead ? '（已倒）' : ''}
          </span>
        </div>
      ))}
      {env && (
        <div className="dev-live-status-line">
          <span className="dev-faint">战场压力（每回合）</span>
          <span>{envPressureText(env)}</span>
        </div>
      )}
      {combat.attackInOrder && (
        <div className="dev-live-status-line">
          <span className="dev-faint">按序攻击</span>
          <span>
            {front
              ? `可打：${describeEnemy(front.defId)?.def.name ?? front.defId}（第 ${
                  frontIdx + 1
                }/${combat.enemies.length} 节·剩 ${enemiesAlive.length}）`
              : '（无存活节）'}
          </span>
        </div>
      )}
    </div>
  );
}

/** 实战终局卡：phase 已非 combat（胜/败/逃/上浮）时显示结果 + loot diff + 再来一局。 */
function LiveTerminalCard({
  live,
  entryState,
  onRestart,
}: {
  live: GameState;
  entryState: GameState | null;
  onRestart: () => void;
}) {
  const phase = live.phase.kind;
  const label =
    phase === 'gameOver'
      ? '战败'
      : phase === 'ascent'
        ? '应急上浮（脱离）'
        : '已结束（胜利 / 脱战）';
  const loot = diffInventorySimple(entryState?.run?.inventory ?? [], live.run?.inventory ?? []);
  return (
    <div className="dev-combat-summary">
      <h4 className="dev-sub-title">战斗结束</h4>
      <table className="dev-combat-summary-table">
        <tbody>
          <tr>
            <td>结果</td>
            <td>{label}</td>
          </tr>
          <tr>
            <td>final phase</td>
            <td>{phase}</td>
          </tr>
          {live.run && (
            <tr>
              <td>final stats</td>
              <td>
                HP={live.run.stats.stamina.toFixed(0)} O2={live.run.stats.oxygen.toFixed(1)} N2=
                {live.run.stats.nitrogen.toFixed(1)}
              </td>
            </tr>
          )}
          <tr>
            <td>loot</td>
            <td>{loot.length === 0 ? '—' : loot.map((l) => `${l.itemId}×${l.qty}`).join(', ')}</td>
          </tr>
        </tbody>
      </table>
      <button className="dev-btn dev-btn-tiny" onClick={onRestart} style={{ marginTop: 8 }}>
        ⟲ 再打一次
      </button>
    </div>
  );
}
