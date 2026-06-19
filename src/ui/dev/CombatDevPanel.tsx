// CombatDevPanel —— 战斗回归 Phase 3 dev 面板（仅 import.meta.env.DEV 下挂载）
//
// 三栏布局：
//   左：combat encounter 列表 + enemies 列表 + ad-hoc 构造器 + describeEnemy 输出
//   中：player state 编辑 + equipment + inventory + seed/maxTurns + actions[] 动态行
//   右：runCombatScenario 实时预览（每回合 player log + enemy HP bars + outcome）+ summary
//
// 设计：
//   - 所有计算走 src/engine/combatScenario.ts，不复刻引擎逻辑
//   - 与 EventDevPanel 视觉一致（复用 .dev-* 控件，叠 .dev-combat-* 战斗专属）
//   - JSON/localStorage 走 CombatScenarioSerializer
//   - localStorage key 加 `.combat.` 中缀避免与事件 scenario 撞 key（quirk #25）
//
// 详见 docs/STATUS.md "战斗回归框架（Phase 3）" 一节。

import { useMemo, useState, useEffect, useRef } from 'react';
import './combat-panel.css';
import {
  runCombatScenario,
  listAllCombats,
  listAllEnemies,
  listAllActions,
  describeEnemy,
  type CombatScenarioInput,
  type CombatScenarioResult,
  type CombatTurnSnapshot,
  type CombatListEntry,
  type EnemyListEntry,
  type EnemySnapshot,
} from '@/engine/combatScenario';
import { createInitialGameState } from '@/engine/state';
import type { Stat } from '@/types';
import { EQUIPMENT_SLOTS, type EquipmentSlot } from '@/types/items';

import {
  emptyCombatFormState,
  formToCombatScenarioInput,
  combatScenarioInputToForm,
  serializeCombatToJson,
  parseCombatScenarioJson,
  suggestedCombatFilename,
  saveCombatScenario,
  loadCombatScenario,
  deleteCombatScenario,
  listSavedCombatScenarios,
  type CombatScenarioFormState,
  type SavedCombatScenarioEntry,
  type ActionRowForm,
} from './CombatScenarioSerializer';

// ---------------------------------------------------------------------------
// 顶层组件
// ---------------------------------------------------------------------------

export interface CombatDevPanelProps {
  onClose: () => void;
}

const STAT_KEYS: Stat[] = ['stamina', 'oxygen', 'sanity', 'nitrogen'];
const SLOT_KEYS = EQUIPMENT_SLOTS;

export function CombatDevPanel({ onClose }: CombatDevPanelProps) {
  // 数据：缓存一次
  const allCombats = useMemo<CombatListEntry[]>(() => listAllCombats(), []);
  const allEnemies = useMemo<EnemyListEntry[]>(() => listAllEnemies(), []);
  const allActions = useMemo(() => listAllActions(), []);

  // 默认选第一个 combat
  const initialCombatId = allCombats[0]?.id ?? '';
  const [form, setForm] = useState<CombatScenarioFormState>(() =>
    emptyCombatFormState(initialCombatId),
  );

  // 左栏选中的"敌人 detail"（独立于战斗选择；点 enemy 列表才更新）
  const [inspectedEnemyId, setInspectedEnemyId] = useState<string>(
    allEnemies[0]?.id ?? '',
  );

  const scenarioInput: CombatScenarioInput = useMemo(
    () => formToCombatScenarioInput(form),
    [form],
  );
  const result: CombatScenarioResult | null = useMemo(() => {
    // 模式校验：combatId 模式空则不跑
    if (form.mode === 'combatId' && !form.combatId) return null;
    if (form.mode === 'adhoc' && form.enemyDefIds.length === 0) return null;
    try {
      return runCombatScenario(scenarioInput);
    } catch (err) {
      return {
        input: scenarioInput,
        resolvedInitialState: createInitialGameState(),
        turns: [],
        summary: {
          outcome: 'invalidCombatId',
          turnsElapsed: 0,
          finalHp: 0,
          finalOxygen: 0,
          finalSanity: 0,
          finalNitrogen: 0,
          statsDelta: {},
          lootGained: [],
          enemiesAlive: [],
          enemiesFinal: [],
          injuriesFinal: [],
          finalPhase: 'error',
          survived: true,
        },
        errors: [`runCombatScenario 抛错：${(err as Error).message}`],
      };
    }
  }, [scenarioInput, form.mode, form.combatId, form.enemyDefIds.length]);

  const enemyDescribed = useMemo(
    () => (inspectedEnemyId ? describeEnemy(inspectedEnemyId) : null),
    [inspectedEnemyId],
  );

  // —— 切换 combat：清掉与该 combat 耦合的字段（actions），保留 variant/seed/maxTurns
  function selectCombat(combatId: string) {
    setForm((prev) => {
      const fresh = emptyCombatFormState(combatId);
      fresh.mode = 'combatId';
      fresh.variant = prev.variant;
      fresh.seed = prev.seed;
      fresh.maxTurns = prev.maxTurns;
      return fresh;
    });
  }

  function toggleMode() {
    setForm((prev) => ({
      ...prev,
      mode: prev.mode === 'combatId' ? 'adhoc' : 'combatId',
      actions: [],
    }));
  }

  // —— ad-hoc enemy 勾选
  function toggleAdhocEnemy(enemyId: string) {
    setForm((prev) => {
      const has = prev.enemyDefIds.includes(enemyId);
      const next = has
        ? prev.enemyDefIds.filter((id) => id !== enemyId)
        : [...prev.enemyDefIds, enemyId];
      return { ...prev, enemyDefIds: next, actions: [] };
    });
  }
  function addAdhocCopy(enemyId: string) {
    setForm((prev) => ({
      ...prev,
      enemyDefIds: [...prev.enemyDefIds, enemyId],
      actions: [],
    }));
  }
  function removeAdhocAt(idx: number) {
    setForm((prev) => ({
      ...prev,
      enemyDefIds: prev.enemyDefIds.filter((_, i) => i !== idx),
      actions: [],
    }));
  }

  // —— actions 行编辑（动态：行数 = max(已填行数+1, result.turns.length)，但用户主动 add 也行）
  function ensureActionRows(min: number) {
    setForm((prev) => {
      if (prev.actions.length >= min) return prev;
      const next = [...prev.actions];
      while (next.length < min) next.push({ actionId: '', targetIndex: '' });
      return { ...prev, actions: next };
    });
  }
  function updateActionRow(idx: number, patch: Partial<ActionRowForm>) {
    setForm((prev) => {
      const next = [...prev.actions];
      while (next.length <= idx) next.push({ actionId: '', targetIndex: '' });
      next[idx] = { ...next[idx], ...patch };
      return { ...prev, actions: next };
    });
  }
  function removeActionAt(idx: number) {
    setForm((prev) => ({
      ...prev,
      actions: prev.actions.filter((_, i) => i !== idx),
    }));
  }
  function clearActions() {
    setForm((prev) => ({ ...prev, actions: [] }));
  }

  // —— stats / equipment / inventory（与事件面板同构）
  function setStat(key: Stat, value: number) {
    setForm((prev) => ({ ...prev, stats: { ...prev.stats, [key]: value } }));
  }
  function toggleStatActive(key: Stat) {
    setForm((prev) => ({
      ...prev,
      statsActive: { ...prev.statsActive, [key]: !prev.statsActive[key] },
    }));
  }
  function toggleEquipmentOverride(slot: EquipmentSlot) {
    setForm((prev) => ({
      ...prev,
      equipmentOverride: {
        ...prev.equipmentOverride,
        [slot]: !prev.equipmentOverride[slot],
      },
    }));
  }
  function setEquipmentId(slot: EquipmentSlot, itemId: string) {
    setForm((prev) => ({
      ...prev,
      equipment: { ...prev.equipment, [slot]: { ...prev.equipment[slot], itemId } },
    }));
  }
  function setEquipmentLevel(slot: EquipmentSlot, level: number) {
    setForm((prev) => ({
      ...prev,
      equipment: { ...prev.equipment, [slot]: { ...prev.equipment[slot], level } },
    }));
  }
  function addInventoryRow() {
    setForm((prev) => ({
      ...prev,
      inventory: [...prev.inventory, { itemId: '', qty: 1 }],
    }));
  }
  function updateInventoryRow(idx: number, patch: Partial<{ itemId: string; qty: number }>) {
    setForm((prev) => {
      const next = [...prev.inventory];
      next[idx] = { ...next[idx], ...patch };
      return { ...prev, inventory: next };
    });
  }
  function removeInventoryRow(idx: number) {
    setForm((prev) => ({
      ...prev,
      inventory: prev.inventory.filter((_, i) => i !== idx),
    }));
  }

  // —— IO（导入/导出/LS）
  const [ioMessage, setIoMessage] = useState<string>('');
  const [importText, setImportText] = useState<string>('');
  const [showImport, setShowImport] = useState(false);

  function flashIo(msg: string) {
    setIoMessage(msg);
    window.setTimeout(() => setIoMessage((m) => (m === msg ? '' : m)), 2400);
  }

  async function handleExport() {
    const json = serializeCombatToJson(scenarioInput);
    try {
      await navigator.clipboard.writeText(json);
      flashIo(
        `已复制 JSON（建议文件名 ${suggestedCombatFilename(form.combatId || 'adhoc', form.variant)}）`,
      );
    } catch {
      flashIo('剪贴板写入失败，请手动复制下方 textarea');
      setImportText(json);
      setShowImport(true);
    }
  }

  function handleImport() {
    try {
      const input = parseCombatScenarioJson(importText);
      const newForm = combatScenarioInputToForm(input);
      newForm.variant = form.variant || 'imported';
      setForm(newForm);
      setShowImport(false);
      setImportText('');
      flashIo('已导入 JSON');
    } catch (err) {
      flashIo(`导入失败：${(err as Error).message}`);
    }
  }

  const [savedList, setSavedList] = useState<SavedCombatScenarioEntry[]>(() =>
    listSavedCombatScenarios(),
  );
  function refreshSavedList() {
    setSavedList(listSavedCombatScenarios());
  }
  function handleSaveLs() {
    const cid = form.mode === 'combatId' ? form.combatId : 'adhoc';
    if (!cid) {
      flashIo('没有 combatId，无法保存');
      return;
    }
    const key = saveCombatScenario(cid, form.variant || 'draft', scenarioInput);
    refreshSavedList();
    flashIo(`已存到 localStorage：${key}`);
  }
  function handleLoadLs(key: string) {
    const input = loadCombatScenario(key);
    if (!input) {
      flashIo(`未找到或解析失败：${key}`);
      return;
    }
    const newForm = combatScenarioInputToForm(input);
    const entry = savedList.find((e) => e.key === key);
    if (entry) newForm.variant = entry.variant;
    setForm(newForm);
    flashIo(`已加载 ${key}`);
  }
  function handleDeleteLs(key: string) {
    deleteCombatScenario(key);
    refreshSavedList();
    flashIo(`已删除 ${key}`);
  }

  // ESC 关闭
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // —— 行数自动跟随 result.turns（玩家边输入边预览，行会自然增长）
  useEffect(() => {
    if (!result) return;
    const needed = Math.min(result.turns.length + 1, (form.maxTurns === '' ? 30 : Number(form.maxTurns)));
    if (form.actions.length < needed) {
      ensureActionRows(needed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.turns.length]);

  // ---------------------------------------------------------------------------
  // 渲染
  // ---------------------------------------------------------------------------

  return (
    <div className="dev-panel" ref={panelRef}>
      <header className="dev-panel-header">
        <div>
          <div className="dev-panel-title">战斗回归 dev 面板</div>
          <div className="dev-panel-sub">
            Phase 3 · {allCombats.length} 个 encounter · {allEnemies.length} 个 enemy · 仅在 DEV 模式可用
          </div>
        </div>
        <div className="dev-panel-header-actions">
          <label className="dev-inline">
            <span>variant</span>
            <input
              className="dev-input"
              value={form.variant}
              onChange={(e) => setForm((p) => ({ ...p, variant: e.target.value }))}
              placeholder="draft"
              style={{ width: 140 }}
            />
          </label>
          <span className="dev-filename">
            → {suggestedCombatFilename(form.combatId || 'adhoc', form.variant)}
          </span>
          <button className="dev-btn" onClick={handleExport}>导出 JSON</button>
          <button className="dev-btn" onClick={() => setShowImport((s) => !s)}>导入 JSON</button>
          <button className="dev-btn" onClick={handleSaveLs}>存 LS</button>
          <button className="dev-btn dev-btn-quiet" onClick={onClose}>关闭 (Esc)</button>
        </div>
      </header>

      {ioMessage && <div className="dev-io-banner">{ioMessage}</div>}

      {showImport && (
        <div className="dev-import-row">
          <textarea
            className="dev-input dev-textarea"
            placeholder='粘贴 CombatScenarioInput JSON，例如 {"combatId":"combat.tutorial_shark","seed":1,"actions":[{"actionId":"action.knife_stab","targetIndex":0}]}'
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <div className="dev-import-actions">
            <button className="dev-btn" onClick={handleImport}>应用</button>
            <button className="dev-btn dev-btn-quiet" onClick={() => setShowImport(false)}>取消</button>
          </div>
        </div>
      )}

      <div className="dev-panel-body">
        {/* ——— 左栏 ——— */}
        <section className="dev-col dev-col-events">
          <h3 className="dev-col-title">encounter / enemy</h3>

          <div className="dev-combat-mode-row">
            <label>
              <input
                type="radio"
                name="mode"
                checked={form.mode === 'combatId'}
                onChange={() => form.mode !== 'combatId' && toggleMode()}
              />
              <span>注册 combat</span>
            </label>
            <label>
              <input
                type="radio"
                name="mode"
                checked={form.mode === 'adhoc'}
                onChange={() => form.mode !== 'adhoc' && toggleMode()}
              />
              <span>ad-hoc 构造</span>
            </label>
          </div>

          {form.mode === 'combatId' && (
            <ul className="dev-combat-encounter-list">
              {allCombats.map((c) => (
                <li
                  key={c.id}
                  className={`dev-combat-encounter-row ${c.id === form.combatId ? 'selected' : ''}`}
                  onClick={() => selectCombat(c.id)}
                >
                  <div className="dev-combat-id">{c.id}</div>
                  <div className="dev-combat-meta">
                    <span>party: {c.memberDefIds.join(', ')}</span>
                    {c.victoryEventId && (
                      <span className="dev-faint">→ {c.victoryEventId}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {form.mode === 'adhoc' && (
            <div className="dev-combat-adhoc-builder">
              <div className="dev-faint" style={{ marginBottom: 4 }}>
                勾选 enemy（可重复添加同一个）；当前 party:{' '}
                {form.enemyDefIds.length === 0 ? '(空)' : form.enemyDefIds.join(', ')}
              </div>
              {allEnemies.map((e) => {
                const count = form.enemyDefIds.filter((id) => id === e.id).length;
                return (
                  <div className="dev-combat-adhoc-row" key={e.id}>
                    <input
                      type="checkbox"
                      checked={count > 0}
                      onChange={() => toggleAdhocEnemy(e.id)}
                    />
                    <span style={{ flex: 1 }}>
                      {e.id} <span className="dev-faint">({e.name}, hp={e.hp})</span>
                      {count > 1 && (
                        <span className="dev-faint"> ×{count}</span>
                      )}
                    </span>
                    <button
                      className="dev-btn dev-btn-tiny"
                      onClick={() => addAdhocCopy(e.id)}
                    >
                      +1
                    </button>
                  </div>
                );
              })}
              {form.enemyDefIds.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <div className="dev-faint">party 顺序（决定 targetIndex）：</div>
                  {form.enemyDefIds.map((id, i) => (
                    <div className="dev-combat-adhoc-row" key={i}>
                      <span className="dev-faint">[{i}]</span>
                      <span style={{ flex: 1 }}>{id}</span>
                      <button
                        className="dev-btn dev-btn-tiny dev-btn-danger"
                        onClick={() => removeAdhocAt(i)}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <h4 className="dev-sub-title">enemy defs（点击查看详情）</h4>
          <ul className="dev-combat-enemy-list">
            {allEnemies.map((e) => (
              <li
                key={e.id}
                className={`dev-combat-enemy-row ${e.id === inspectedEnemyId ? 'selected' : ''}`}
                onClick={() => setInspectedEnemyId(e.id)}
              >
                <div className="dev-combat-id">{e.id}</div>
                <div className="dev-combat-meta">
                  <span>{e.name}</span>
                  <span className="dev-faint">
                    hp={e.hp} armor={e.armor} threat={e.threat} ({e.tier}/{e.hostility})
                  </span>
                </div>
              </li>
            ))}
          </ul>

          {enemyDescribed && (
            <div className="dev-combat-describe">
              <h5>{enemyDescribed.def.name} · 详情</h5>
              <ul>
                <li>tier={enemyDescribed.def.tier}, ai={enemyDescribed.def.aiPattern}, stance={enemyDescribed.def.initialStance}</li>
                <li>hp={enemyDescribed.def.hp}, armor={enemyDescribed.def.armor}, evasion={enemyDescribed.def.evasion}, threat={enemyDescribed.def.threat}</li>
                <li>flee: {enemyDescribed.fleeThresholdDescription}</li>
                <li>victory: [{enemyDescribed.victoryConditions.join(', ')}]</li>
              </ul>
              <h5>攻击表</h5>
              <ul>
                {enemyDescribed.attackSummary.map((a) => (
                  <li key={a.id}>
                    <strong>{a.name}</strong> ({a.id}) · {a.damageType} dmg={a.damage[0]}-{a.damage[1]}
                    {a.sanityDamage ? `, sanity=${a.sanityDamage[0]}-${a.sanityDamage[1]}` : ''}, w={a.weight}
                  </li>
                ))}
              </ul>
              <h5>战利品</h5>
              <ul>
                {enemyDescribed.loot.guaranteed.map((l, i) => (
                  <li key={`g${i}`}>guaranteed: {l.itemId} ×{l.qty[0]}-{l.qty[1]}</li>
                ))}
                {enemyDescribed.loot.rolls.map((l, i) => (
                  <li key={`r${i}`}>roll: {l.itemId} ×{l.qty[0]}-{l.qty[1]} (w={l.weight})</li>
                ))}
                <li>rollCount: {enemyDescribed.loot.rollCount}</li>
              </ul>
            </div>
          )}
        </section>

        {/* ——— 中栏 ——— */}
        <section className="dev-col dev-col-form">
          <h3 className="dev-col-title">状态覆写</h3>

          <div className="dev-section">
            <h4 className="dev-sub-title">stats（勾选 = 覆写默认满状态）</h4>
            {STAT_KEYS.map((k) => (
              <div className="dev-stat-row" key={k}>
                <label className="dev-checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.statsActive[k]}
                    onChange={() => toggleStatActive(k)}
                  />
                  <span className="dev-stat-key">{k}</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={k === 'sanity' || k === 'nitrogen' ? 100 : 200}
                  value={form.stats[k]}
                  disabled={!form.statsActive[k]}
                  onChange={(e) => setStat(k, Number(e.target.value))}
                  className="dev-range"
                />
                <input
                  type="number"
                  value={form.stats[k]}
                  disabled={!form.statsActive[k]}
                  onChange={(e) => setStat(k, Number(e.target.value))}
                  className="dev-input dev-input-num"
                />
              </div>
            ))}
          </div>

          <div className="dev-section">
            <h4 className="dev-sub-title">equipment（勾选 = 覆写该槽，留空 itemId = null）</h4>
            {SLOT_KEYS.map((slot) => (
              <div className="dev-eq-row" key={slot}>
                <label className="dev-checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.equipmentOverride[slot]}
                    onChange={() => toggleEquipmentOverride(slot)}
                  />
                  <span className="dev-stat-key">{slot}</span>
                </label>
                <input
                  className="dev-input"
                  value={form.equipment[slot].itemId}
                  disabled={!form.equipmentOverride[slot]}
                  onChange={(e) => setEquipmentId(slot, e.target.value)}
                  placeholder="itemId（空 = null）"
                />
                <input
                  className="dev-input dev-input-num"
                  type="number"
                  min={1}
                  value={form.equipment[slot].level}
                  disabled={!form.equipmentOverride[slot]}
                  onChange={(e) => setEquipmentLevel(slot, Number(e.target.value))}
                />
              </div>
            ))}
          </div>

          <div className="dev-section">
            <h4 className="dev-sub-title">
              inventory（影响 use_item / requiresItemId 行动解锁）
              <button className="dev-btn dev-btn-tiny" onClick={addInventoryRow}>+ 加一行</button>
            </h4>
            {form.inventory.length === 0 && <p className="dev-faint">（空）</p>}
            {form.inventory.map((row, i) => (
              <div className="dev-inv-row" key={i}>
                <input
                  className="dev-input"
                  value={row.itemId}
                  onChange={(e) => updateInventoryRow(i, { itemId: e.target.value })}
                  placeholder="item.med_kit"
                />
                <input
                  className="dev-input dev-input-num"
                  type="number"
                  min={1}
                  value={row.qty}
                  onChange={(e) => updateInventoryRow(i, { qty: Number(e.target.value) })}
                />
                <button className="dev-btn dev-btn-tiny" onClick={() => removeInventoryRow(i)}>✕</button>
              </div>
            ))}
          </div>

          <div className="dev-section">
            <h4 className="dev-sub-title">upgrades（逗号分隔）</h4>
            <label className="dev-stack">
              <span>unlockedUpgrades</span>
              <input
                className="dev-input"
                value={form.unlockedUpgrades}
                onChange={(e) => setForm((p) => ({ ...p, unlockedUpgrades: e.target.value }))}
                placeholder="upgrade.docks.lv1, ..."
              />
            </label>
            <label className="dev-stack">
              <span>zoneId（影响 run.zoneId，不影响战斗）</span>
              <input
                className="dev-input"
                value={form.zoneId}
                onChange={(e) => setForm((p) => ({ ...p, zoneId: e.target.value }))}
                placeholder="zone.old_lighthouse_reef"
              />
            </label>
            <label className="dev-stack">
              <span>depth</span>
              <input
                className="dev-input dev-input-num"
                type="number"
                value={form.depth}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    depth: e.target.value === '' ? '' : Number(e.target.value),
                  }))
                }
              />
            </label>
          </div>

          <div className="dev-section">
            <h4 className="dev-sub-title">RNG / 回合</h4>
            <div className="dev-row">
              <label className="dev-inline">
                <span>seed</span>
                <input
                  className="dev-input dev-input-num"
                  type="number"
                  value={form.seed}
                  placeholder="留空 = 真随机"
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      seed: e.target.value === '' ? '' : Number(e.target.value),
                    }))
                  }
                />
              </label>
              <label className="dev-inline">
                <span>maxTurns</span>
                <input
                  className="dev-input dev-input-num"
                  type="number"
                  min={1}
                  value={form.maxTurns}
                  placeholder="默认 30"
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      maxTurns: e.target.value === '' ? '' : Number(e.target.value),
                    }))
                  }
                />
              </label>
            </div>
          </div>

          <div className="dev-section">
            <h4 className="dev-sub-title">
              actions（按回合顺序）
              <span>
                <button
                  className="dev-btn dev-btn-tiny"
                  onClick={() => ensureActionRows(form.actions.length + 1)}
                >
                  + 加一行
                </button>
                <button className="dev-btn dev-btn-tiny" onClick={clearActions}>清空</button>
              </span>
            </h4>
            <ActionsEditor
              form={form}
              actions={allActions.map((a) => ({ id: a.id, name: a.name }))}
              turns={result?.turns ?? []}
              updateRow={updateActionRow}
              removeRow={removeActionAt}
            />
          </div>

          {savedList.length > 0 && (
            <div className="dev-section">
              <h4 className="dev-sub-title">已存 localStorage</h4>
              <ul className="dev-saved-list">
                {savedList.map((s) => (
                  <li key={s.key} className="dev-saved-row">
                    <button
                      className="dev-btn dev-btn-tiny"
                      onClick={() => handleLoadLs(s.key)}
                    >
                      载入
                    </button>
                    <span className="dev-saved-key">{s.combatId}__{s.variant}</span>
                    <button
                      className="dev-btn dev-btn-tiny dev-btn-danger"
                      onClick={() => handleDeleteLs(s.key)}
                    >
                      删
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* ——— 右栏 ——— */}
        <section className="dev-col dev-col-preview">
          <h3 className="dev-col-title">runCombatScenario 实时输出</h3>
          {!result ? (
            <p className="dev-faint">
              {form.mode === 'combatId' ? '选一个 combat 开始' : '至少勾一个 enemy 开始 ad-hoc'}
            </p>
          ) : (
            <CombatPreview result={result} />
          )}
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Actions Editor
// ---------------------------------------------------------------------------

interface ActionsEditorProps {
  form: CombatScenarioFormState;
  actions: { id: string; name: string }[];
  turns: CombatTurnSnapshot[];
  updateRow: (idx: number, patch: Partial<ActionRowForm>) => void;
  removeRow: (idx: number) => void;
}

function ActionsEditor({ form, actions, turns, updateRow, removeRow }: ActionsEditorProps) {
  // 每行预览能看到的"该回合开局活敌人列表"——用前一回合的 enemiesAfter，或第 0 回合用 result.summary.enemiesFinal（仅 turns 为空时）
  const rows: JSX.Element[] = [];
  const slotCount = Math.max(form.actions.length, turns.length + 1);

  for (let i = 0; i < slotCount; i++) {
    const row = form.actions[i] ?? { actionId: '', targetIndex: '' };
    // 该回合的"敌人选项"：上一回合 enemiesAfter（第 0 回合从 turns[0]?.enemiesAfter 反推不到——干脆给 enemiesFinal）
    const enemyOptionsBase =
      i === 0
        ? turns[0]?.enemiesAfter ?? []
        : turns[i - 1]?.enemiesAfter ?? [];
    rows.push(
      <div className="dev-combat-action-row" key={i}>
        <span className="dev-step-no">t{i + 1}</span>
        <select
          className="dev-input"
          value={row.actionId}
          onChange={(e) => updateRow(i, { actionId: e.target.value })}
        >
          <option value="">（不选 — 停步）</option>
          {actions.map((a) => (
            <option key={a.id} value={a.id}>{a.id}  ({a.name})</option>
          ))}
        </select>
        <select
          className="dev-input dev-input-num"
          value={row.targetIndex}
          onChange={(e) => updateRow(i, { targetIndex: e.target.value })}
          title="targetIndex（缺省 = 第一个活敌人）"
        >
          <option value="">tgt:auto</option>
          {enemyOptionsBase.map((e, idx) => (
            <option key={idx} value={idx} disabled={e.hp <= 0}>
              [{idx}] {e.name}{e.hp <= 0 ? ' (☠)' : ''}
            </option>
          ))}
        </select>
        <button className="dev-btn dev-btn-tiny" onClick={() => removeRow(i)}>✕</button>
      </div>,
    );
  }
  return <div>{rows}</div>;
}

// ---------------------------------------------------------------------------
// 预览
// ---------------------------------------------------------------------------

function CombatPreview({ result }: { result: CombatScenarioResult }) {
  return (
    <div className="dev-preview">
      {result.errors.length > 0 && (
        <div className="dev-errors">
          <h4 className="dev-sub-title">errors</h4>
          <ul>
            {result.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {result.turns.map((t) => (
        <TurnBlock key={t.turnIndex} turn={t} />
      ))}

      <CombatSummaryBlock result={result} />
    </div>
  );
}

function TurnBlock({ turn }: { turn: CombatTurnSnapshot }) {
  const cls = !turn.available
    ? 'unavailable'
    : turn.outcome === 'victory'
      ? 'outcome-victory'
      : turn.outcome === 'defeat'
        ? 'outcome-defeat'
        : '';
  return (
    <div className={`dev-combat-turn ${cls}`}>
      <div className="dev-combat-turn-head">
        <span className="dev-combat-turn-no">turn {turn.turnIndex + 1}</span>
        <span className="dev-combat-turn-action">{turn.actionName}</span>
        <span className="dev-faint">({turn.actionId})</span>
        {turn.targetName && (
          <span className="dev-combat-turn-target">→ {turn.targetName}</span>
        )}
      </div>

      {!turn.available && (
        <div className="dev-errors">
          ✗ 不可用：{turn.unavailableReason ?? '未知原因'}
        </div>
      )}

      {turn.log.length > 0 && (
        <div className="dev-combat-turn-log">
          {turn.log.map((l, i) => (
            <p key={i} className={`actor-${l.actor}`}>
              <strong>[{l.actor}]</strong> {l.text}
            </p>
          ))}
        </div>
      )}

      <div className="dev-combat-player-stats">
        <span>HP={turn.playerStatsAfter.stamina.toFixed(0)}</span>
        <span>O2={turn.playerStatsAfter.oxygen.toFixed(1)}</span>
        <span>San={turn.playerStatsAfter.sanity.toFixed(0)}</span>
        <span>N2={turn.playerStatsAfter.nitrogen.toFixed(1)}</span>
        <span className="dev-combat-player-delta">
          Δ {formatStatsDelta(turn.playerStatsDelta) || '—'}
        </span>
      </div>

      <div className="dev-combat-enemies-block">
        {turn.enemiesAfter.map((e) => (
          <EnemyHpLine key={e.instanceId} enemy={e} />
        ))}
      </div>

      <div className={`dev-combat-outcome-line ${turn.outcome}`}>
        outcome: {turn.outcome}
      </div>
    </div>
  );
}

function EnemyHpLine({ enemy }: { enemy: EnemySnapshot }) {
  const pct = enemy.hpMax > 0 ? Math.max(0, Math.min(1, enemy.hp / enemy.hpMax)) : 0;
  const fillCls = enemy.hp <= 0 ? 'dead' : pct < 0.3 ? 'low' : '';
  const statuses = enemy.statuses.length > 0 ? ' [' + enemy.statuses.map((s) => s.kind).join(',') + ']' : '';
  return (
    <div className="dev-combat-enemy-line">
      <span className="dev-combat-enemy-name">{enemy.name}</span>
      <div className="dev-combat-hpbar" title={`${enemy.hp}/${enemy.hpMax}`}>
        <div className={`dev-combat-hpbar-fill ${fillCls}`} style={{ width: `${pct * 100}%` }} />
      </div>
      <span className="dev-combat-hp-text">{enemy.hp}/{enemy.hpMax}</span>
      <span className="dev-combat-stance">
        {enemy.stance}{statuses}
      </span>
    </div>
  );
}

function formatStatsDelta(d: Partial<Record<Stat, number>>): string {
  return (['stamina', 'oxygen', 'sanity', 'nitrogen'] as const)
    .filter((k) => d[k] !== undefined)
    .map((k) => `${k} ${(d[k] as number) >= 0 ? '+' : ''}${d[k]}`)
    .join(', ');
}

function CombatSummaryBlock({ result }: { result: CombatScenarioResult }) {
  const s = result.summary;
  return (
    <div className="dev-combat-summary">
      <h4 className="dev-sub-title">summary</h4>
      <table className="dev-combat-summary-table">
        <tbody>
          <tr>
            <td>outcome</td>
            <td>{s.outcome}</td>
          </tr>
          <tr>
            <td>survived</td>
            <td>{s.survived ? 'yes' : 'no'}</td>
          </tr>
          <tr>
            <td>turnsElapsed</td>
            <td>{s.turnsElapsed}</td>
          </tr>
          <tr>
            <td>final stats</td>
            <td>
              HP={s.finalHp.toFixed(0)} O2={s.finalOxygen.toFixed(1)} San={s.finalSanity.toFixed(0)} N2=
              {s.finalNitrogen.toFixed(1)}
            </td>
          </tr>
          <tr>
            <td>stats Δ</td>
            <td>{formatStatsDelta(s.statsDelta) || '—'}</td>
          </tr>
          <tr>
            <td>loot</td>
            <td>
              {s.lootGained.length === 0 ? '—' : s.lootGained.map((l) => `${l.itemId}×${l.qty}`).join(', ')}
            </td>
          </tr>
          <tr>
            <td>enemies alive</td>
            <td>
              {s.enemiesAlive.length === 0
                ? '(全部 hp ≤ 0)'
                : s.enemiesAlive.map((e) => `${e.name}(hp=${e.hp})`).join(', ')}
            </td>
          </tr>
          <tr>
            <td>final phase</td>
            <td>{s.finalPhase}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
