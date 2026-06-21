// EventDevPanel —— 事件回归 Phase 2 dev 面板（仅 import.meta.env.DEV 下挂载）
//
// 三栏布局：
//   左：事件选择 + zoneTag 过滤 + describeEvent 输出
//   中：状态编辑（stats / depth / zone / equipment / inventory / flags / seed / chain / choices）
//   右：runEventScenario 实时预览（每步 visible/hidden options + chosen + deltas + next + summary）
//
// 设计：
//   - 所有计算走 src/engine/eventScenario.ts，不复刻引擎逻辑
//   - 不写新 GamePhase，devPanel 开关只在 App.tsx 顶层 useState 里管
//   - 只读 import.meta.env.DEV；prod build 时 App.tsx 处的 lazy + DEV 守卫让本文件不进 bundle
//   - JSON 互转 + localStorage 都委托 ScenarioSerializer
//
// 详见 docs/STATUS.md "事件回归框架（Phase 2 dev 面板）" 一节。

import { useMemo, useState, useEffect, useRef } from 'react';
import './dev-panel.css';
import {
  runEventScenario,
  listAllEvents,
  describeEvent,
  type ScenarioInput,
  type ScenarioResult,
  type ScenarioStep,
  type EventListEntry,
} from '@/engine/eventScenario';
import type { Stat } from '@/types';
import { EQUIPMENT_SLOTS, type EquipmentSlot } from '@/types/items';
import { createInitialGameState } from '@/engine/state';

import {
  emptyFormState,
  formToScenarioInput,
  scenarioInputToForm,
  serializeToJson,
  parseScenarioJson,
  suggestedFilename,
  saveScenario,
  loadScenario,
  deleteScenario,
  listSavedScenarios,
  type ScenarioFormState,
  type SavedScenarioEntry,
} from './ScenarioSerializer';

// ---------------------------------------------------------------------------
// 顶层组件
// ---------------------------------------------------------------------------

export interface EventDevPanelProps {
  onClose?: () => void;
}

const ALL_ZONE_TAGS = ['tutorial', 'reef', 'cave', 'wreck', 'shallow', 'deep'] as const;
const STAT_KEYS: Stat[] = ['stamina', 'oxygen', 'sanity', 'nitrogen'];
const SLOT_KEYS = EQUIPMENT_SLOTS;

export function EventDevPanel({ onClose }: EventDevPanelProps) {
  // —— 事件列表（cache 一次；EVENT_DB 在 module load 时就装好了）
  const allEvents = useMemo<EventListEntry[]>(() => listAllEvents(), []);

  // —— 过滤
  const [filterText, setFilterText] = useState('');
  const [filterZoneTag, setFilterZoneTag] = useState<string>('');

  const filteredEvents = useMemo(() => {
    const txt = filterText.trim().toLowerCase();
    return allEvents.filter((e) => {
      if (filterZoneTag && !(e.zoneTags ?? []).includes(filterZoneTag)) return false;
      if (!txt) return true;
      return (
        e.id.toLowerCase().includes(txt) ||
        e.title.toLowerCase().includes(txt)
      );
    });
  }, [allEvents, filterText, filterZoneTag]);

  // —— 表单 state
  const initialEventId = allEvents[0]?.id ?? '';
  const [form, setForm] = useState<ScenarioFormState>(() => emptyFormState(initialEventId));

  // —— ScenarioInput + runEventScenario 派生
  const scenarioInput: ScenarioInput = useMemo(() => formToScenarioInput(form), [form]);
  const result: ScenarioResult | null = useMemo(() => {
    if (!form.eventId) return null;
    try {
      return runEventScenario(scenarioInput);
    } catch (err) {
      return {
        input: scenarioInput,
        resolvedInitialState: createInitialGameState(),
        steps: [],
        summary: {
          statsDelta: {},
          inventoryGained: [],
          profileFlagsAdded: [],
          runFlagsAdded: [],
          bankedGoldDelta: 0,
          loreAdded: [],
          survived: true,
          finalPhase: 'error',
        },
        errors: [`runEventScenario 抛错：${(err as Error).message}`],
      };
    }
  }, [scenarioInput, form.eventId]);

  // —— describeEvent 输出（左栏底部）
  const eventDescribed = useMemo(
    () => (form.eventId ? describeEvent(form.eventId) : null),
    [form.eventId],
  );

  // —— 切换事件：清掉与该事件耦合的字段（depth/choices/zoneId），保留 variant/chain/maxSteps
  function selectEvent(eventId: string) {
    setForm((prev) => {
      const fresh = emptyFormState(eventId);
      fresh.variant = prev.variant;
      fresh.chain = prev.chain;
      fresh.maxSteps = prev.maxSteps;
      return fresh;
    });
  }

  // —— 选项序列编辑：改第 i 步时把后面的全清掉
  function setChoiceAt(stepIndex: number, optionId: string) {
    setForm((prev) => {
      const next = [...prev.choices.slice(0, stepIndex)];
      if (optionId) next.push(optionId);
      return { ...prev, choices: next };
    });
  }
  function clearChoices() {
    setForm((prev) => ({ ...prev, choices: [] }));
  }

  // —— stats 编辑
  function setStat(key: Stat, value: number) {
    setForm((prev) => ({ ...prev, stats: { ...prev.stats, [key]: value } }));
  }
  function toggleStatActive(key: Stat) {
    setForm((prev) => ({
      ...prev,
      statsActive: { ...prev.statsActive, [key]: !prev.statsActive[key] },
    }));
  }

  // —— equipment
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

  // —— inventory
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

  // —— 导入/导出/保存/加载
  const [ioMessage, setIoMessage] = useState<string>('');
  const [importText, setImportText] = useState<string>('');
  const [showImport, setShowImport] = useState(false);

  function flashIo(msg: string) {
    setIoMessage(msg);
    window.setTimeout(() => setIoMessage((m) => (m === msg ? '' : m)), 2400);
  }

  async function handleExport() {
    const json = serializeToJson(scenarioInput);
    try {
      await navigator.clipboard.writeText(json);
      flashIo(`已复制 JSON（建议文件名 ${suggestedFilename(form.eventId, form.variant)}）`);
    } catch {
      flashIo('剪贴板写入失败，请手动复制下方 textarea');
      setImportText(json);
      setShowImport(true);
    }
  }

  function handleImport() {
    try {
      const input = parseScenarioJson(importText);
      const newForm = scenarioInputToForm(input);
      // 保留 variant（如用户在面板里改过）
      newForm.variant = form.variant || 'imported';
      setForm(newForm);
      setShowImport(false);
      setImportText('');
      flashIo('已导入 JSON');
    } catch (err) {
      flashIo(`导入失败：${(err as Error).message}`);
    }
  }

  const [savedList, setSavedList] = useState<SavedScenarioEntry[]>(() => listSavedScenarios());
  function refreshSavedList() {
    setSavedList(listSavedScenarios());
  }
  function handleSaveLs() {
    if (!form.eventId) {
      flashIo('没有 eventId，无法保存');
      return;
    }
    const key = saveScenario(form.eventId, form.variant || 'draft', scenarioInput);
    refreshSavedList();
    flashIo(`已存到 localStorage：${key}`);
  }
  function handleLoadLs(key: string) {
    const input = loadScenario(key);
    if (!input) {
      flashIo(`未找到或解析失败：${key}`);
      return;
    }
    const newForm = scenarioInputToForm(input);
    // 还原 variant：从 key 反推
    const entry = savedList.find((e) => e.key === key);
    if (entry) newForm.variant = entry.variant;
    setForm(newForm);
    flashIo(`已加载 ${key}`);
  }
  function handleDeleteLs(key: string) {
    deleteScenario(key);
    refreshSavedList();
    flashIo(`已删除 ${key}`);
  }

  // —— 防止全局键盘 shortcut 干扰：input/textarea 内部按键不冒泡到 App 的 Shift+D
  const panelRef = useRef<HTMLDivElement>(null);

  // ESC 关闭面板
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose?.();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ---------------------------------------------------------------------------
  // 渲染
  // ---------------------------------------------------------------------------

  return (
    <div className="dev-panel" ref={panelRef}>
      <header className="dev-panel-header">
        <div>
          <div className="dev-panel-title">事件回归 dev 面板</div>
          <div className="dev-panel-sub">
            Phase 2 · {allEvents.length} 个事件 · 仅在 DEV 模式可用
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
          <span className="dev-filename">→ {suggestedFilename(form.eventId, form.variant)}</span>
          <button className="dev-btn" onClick={handleExport}>导出 JSON</button>
          <button className="dev-btn" onClick={() => setShowImport((s) => !s)}>导入 JSON</button>
          <button className="dev-btn" onClick={handleSaveLs}>存 LS</button>
          {onClose && <button className="dev-btn dev-btn-quiet" onClick={onClose}>关闭 (Esc)</button>}
        </div>
      </header>

      {ioMessage && <div className="dev-io-banner">{ioMessage}</div>}

      {showImport && (
        <div className="dev-import-row">
          <textarea
            className="dev-input dev-textarea"
            placeholder='粘贴 ScenarioInput JSON，例如 {"eventId":"tutorial.descent","stats":{"sanity":70},"choices":["continue"]}'
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
        {/* ——— 左栏：事件选择 ——— */}
        <section className="dev-col dev-col-events">
          <h3 className="dev-col-title">事件 ({filteredEvents.length}/{allEvents.length})</h3>
          <div className="dev-filter-row">
            <input
              className="dev-input"
              placeholder="按 id 或 title 过滤"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
            <select
              className="dev-input"
              value={filterZoneTag}
              onChange={(e) => setFilterZoneTag(e.target.value)}
            >
              <option value="">所有 tag</option>
              {ALL_ZONE_TAGS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <ul className="dev-event-list">
            {filteredEvents.map((e) => (
              <li
                key={e.id}
                className={`dev-event-item ${e.id === form.eventId ? 'selected' : ''}`}
                onClick={() => selectEvent(e.id)}
              >
                <div className="dev-event-id">{e.id}</div>
                <div className="dev-event-meta">
                  <span>{e.title}</span>
                  <span className="dev-faint">
                    {e.depthRange[0]}–{e.depthRange[1]}m · {e.tone} · [{(e.zoneTags ?? []).join(',')}]
                  </span>
                </div>
              </li>
            ))}
          </ul>

          {eventDescribed && (
            <div className="dev-describe">
              <h4 className="dev-sub-title">选项概览</h4>
              <pre className="dev-pre">
                {eventDescribed.optionSummary.map((opt) => {
                  const head = `[${opt.id}] "${opt.label}"${opt.hasCheck ? ' (check)' : ''}`;
                  return [head, ...opt.outcomes.map((o) => '  ' + o)].join('\n');
                }).join('\n')}
              </pre>
            </div>
          )}
        </section>

        {/* ——— 中栏：表单 ——— */}
        <section className="dev-col dev-col-form">
          <h3 className="dev-col-title">状态覆写</h3>

          {/* stats */}
          <div className="dev-section">
            <h4 className="dev-sub-title">stats（勾选表示覆写默认满状态）</h4>
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

          {/* depth / zone */}
          <div className="dev-section">
            <h4 className="dev-sub-title">depth / zone</h4>
            <div className="dev-row">
              <label className="dev-inline">
                <span>depth</span>
                <input
                  className="dev-input dev-input-num"
                  type="number"
                  value={form.depth}
                  placeholder={
                    eventDescribed
                      ? String(eventDescribed.event.depthRange[0])
                      : '—'
                  }
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      depth: e.target.value === '' ? '' : Number(e.target.value),
                    }))
                  }
                />
              </label>
              <label className="dev-inline" style={{ flex: 1 }}>
                <span>zoneId</span>
                <input
                  className="dev-input"
                  value={form.zoneId}
                  placeholder="留空 = 推断（cave→blue_caves）"
                  onChange={(e) => setForm((p) => ({ ...p, zoneId: e.target.value }))}
                />
              </label>
            </div>
          </div>

          {/* equipment */}
          <div className="dev-section">
            <h4 className="dev-sub-title">equipment（勾选 = 覆写该槽，留空 itemId 表示 null）</h4>
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

          {/* inventory */}
          <div className="dev-section">
            <h4 className="dev-sub-title">
              inventory
              <button className="dev-btn dev-btn-tiny" onClick={addInventoryRow}>+ 加一行</button>
            </h4>
            {form.inventory.length === 0 && <p className="dev-faint">（空）</p>}
            {form.inventory.map((row, i) => (
              <div className="dev-inv-row" key={i}>
                <input
                  className="dev-input"
                  value={row.itemId}
                  onChange={(e) => updateInventoryRow(i, { itemId: e.target.value })}
                  placeholder="item.eel_skin"
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

          {/* flags / lore / gold */}
          <div className="dev-section">
            <h4 className="dev-sub-title">flags · lore · gold（逗号分隔）</h4>
            <label className="dev-stack">
              <span>profileFlags</span>
              <input
                className="dev-input"
                value={form.profileFlags}
                onChange={(e) => setForm((p) => ({ ...p, profileFlags: e.target.value }))}
                placeholder="flag.event_done.xxx, ..."
              />
            </label>
            <label className="dev-stack">
              <span>runFlags</span>
              <input
                className="dev-input"
                value={form.runFlags}
                onChange={(e) => setForm((p) => ({ ...p, runFlags: e.target.value }))}
              />
            </label>
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
              <span>loreEntries</span>
              <input
                className="dev-input"
                value={form.loreEntries}
                onChange={(e) => setForm((p) => ({ ...p, loreEntries: e.target.value }))}
              />
            </label>
            <label className="dev-stack">
              <span>bankedGold</span>
              <input
                className="dev-input dev-input-num"
                type="number"
                value={form.bankedGold}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    bankedGold: e.target.value === '' ? '' : Number(e.target.value),
                  }))
                }
              />
            </label>
          </div>

          {/* seed / chain / maxSteps */}
          <div className="dev-section">
            <h4 className="dev-sub-title">RNG / 链路</h4>
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
                <span>chain</span>
                <select
                  className="dev-input"
                  value={form.chain}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      chain: e.target.value as ScenarioFormState['chain'],
                    }))
                  }
                >
                  <option value="follow">follow（默认）</option>
                  <option value="isolated">isolated（不跟链）</option>
                </select>
              </label>
              <label className="dev-inline">
                <span>maxSteps</span>
                <input
                  className="dev-input dev-input-num"
                  type="number"
                  min={1}
                  value={form.maxSteps}
                  placeholder="默认 10"
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      maxSteps: e.target.value === '' ? '' : Number(e.target.value),
                    }))
                  }
                />
              </label>
            </div>
          </div>

          {/* choices */}
          <div className="dev-section">
            <h4 className="dev-sub-title">
              choices（按步选择 option.id）
              <button className="dev-btn dev-btn-tiny" onClick={clearChoices}>清空</button>
            </h4>
            <ChoicesEditor form={form} result={result} setChoiceAt={setChoiceAt} />
          </div>

          {/* localStorage 列表 */}
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
                    <span className="dev-saved-key">{s.eventId}__{s.variant}</span>
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

        {/* ——— 右栏：预览 ——— */}
        <section className="dev-col dev-col-preview">
          <h3 className="dev-col-title">runEventScenario 实时输出</h3>
          {!result || !form.eventId ? (
            <p className="dev-faint">选一个事件开始</p>
          ) : (
            <PreviewBlock result={result} />
          )}
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Choices 编辑：根据当前 result 渲染每步可见 option 的下拉
// ---------------------------------------------------------------------------

interface ChoicesEditorProps {
  form: ScenarioFormState;
  result: ScenarioResult | null;
  setChoiceAt: (i: number, id: string) => void;
}

function ChoicesEditor({ form, result, setChoiceAt }: ChoicesEditorProps) {
  if (!result) return <p className="dev-faint">没有 result 可参考</p>;

  // 总步数 = max(已选的步数, result.steps 长度)
  // result.steps 一般等于已选步数（或 +1，如果"未选最后一步只扫描"）
  const totalSlots = Math.max(form.choices.length + 1, result.steps.length);
  const rows: JSX.Element[] = [];
  for (let i = 0; i < totalSlots; i++) {
    const step = result.steps[i];
    if (!step) {
      // 没扫到这一步——可能因为前一步是 forceAscend/death/combat/remainOnEvent
      break;
    }
    const currentChoice = form.choices[i] ?? '';
    rows.push(
      <div className="dev-choice-row" key={i}>
        <span className="dev-step-no">step {i + 1}</span>
        <span className="dev-faint dev-event-id-mini">{step.eventId}</span>
        <select
          className="dev-input"
          value={currentChoice}
          onChange={(e) => setChoiceAt(i, e.target.value)}
        >
          <option value="">（不选 — 只扫描）</option>
          {step.visibleOptions.map((opt) => {
            let label = opt.id;
            if (opt.checkInfo) {
              const pct = Math.round(opt.checkInfo.estimatedSuccessRate * 100);
              label += `  [${opt.checkInfo.stat} vs ${opt.checkInfo.dc} ≈ ${pct}%]`;
            }
            return (
              <option key={opt.id} value={opt.id}>{label}</option>
            );
          })}
        </select>
      </div>,
    );
  }

  return <div className="dev-choices-stack">{rows}</div>;
}

// ---------------------------------------------------------------------------
// 预览块
// ---------------------------------------------------------------------------

function PreviewBlock({ result }: { result: ScenarioResult }) {
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

      {result.steps.map((step) => (
        <StepBlock key={step.stepIndex} step={step} />
      ))}

      <SummaryBlock result={result} />
    </div>
  );
}

function StepBlock({ step }: { step: ScenarioStep }) {
  return (
    <div className={`dev-step dev-step-tone-${step.eventTone}`}>
      <div className="dev-step-head">
        <span className="dev-step-no">step {step.stepIndex + 1}</span>
        <span className="dev-step-title">{step.eventTitle}</span>
        <span className="dev-faint">[{step.eventTone}]</span>
      </div>
      <div className="dev-step-id dev-faint">{step.eventId}</div>
      <div className="dev-step-body">
        {step.eventBody.split('\n').map((ln, i) => (
          <p key={i}>{ln}</p>
        ))}
      </div>

      <div className="dev-options-block">
        <div className="dev-options-head">visible ({step.visibleOptions.length})</div>
        <ul className="dev-options-list">
          {step.visibleOptions.map((opt) => (
            <li
              key={opt.id}
              className={`dev-option-row ${
                opt.id === step.chosenId ? 'chosen' : ''
              } ${opt.hallucination ? 'hallucination' : ''}`}
            >
              <span className="dev-option-mark">{opt.id === step.chosenId ? '►' : '✓'}</span>
              <span className="dev-option-id">{opt.id}</span>
              <span className="dev-option-label">{opt.label}</span>
              {opt.checkInfo && (
                <span className="dev-faint">
                  {opt.checkInfo.stat} vs {opt.checkInfo.dc} ≈{' '}
                  {(opt.checkInfo.estimatedSuccessRate * 100).toFixed(0)}%
                </span>
              )}
            </li>
          ))}
          {step.visibleOptions.length === 0 && (
            <li className="dev-faint">（无可见选项）</li>
          )}
        </ul>
      </div>

      {step.hiddenOptions.length > 0 && (
        <div className="dev-options-block">
          <div className="dev-options-head">hidden ({step.hiddenOptions.length})</div>
          <ul className="dev-options-list">
            {step.hiddenOptions.map((opt) => (
              <li key={opt.id} className="dev-option-row dev-option-hidden">
                <span className="dev-option-mark">✗</span>
                <span className="dev-option-id">{opt.id}</span>
                <span className="dev-option-label">{opt.label}</span>
                <span className="dev-faint">— {opt.blockedBy}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {step.checkResult && (
        <div className={`dev-check ${step.checkResult.passed ? 'pass' : 'fail'}`}>
          check [{step.checkResult.stat} vs {step.checkResult.dc}] rate={
            (step.checkResult.rate * 100).toFixed(1)
          }% → {step.checkResult.passed ? '成功' : '失败'}
        </div>
      )}

      {step.narrative.length > 0 && (
        <div className="dev-narrative">
          {step.narrative.map((n, i) => (
            <p key={i}>{n}</p>
          ))}
        </div>
      )}

      <DeltasBlock deltas={step.deltas} />

      <div className="dev-next">next: <NextLabel next={step.next} /></div>
    </div>
  );
}

function DeltasBlock({ deltas }: { deltas: ScenarioStep['deltas'] }) {
  const empty =
    Object.keys(deltas.stats).length === 0 &&
    deltas.inventoryAdded.length === 0 &&
    deltas.flagsAdded.length === 0 &&
    deltas.goldDelta === 0 &&
    deltas.loreAdded.length === 0;
  if (empty) return null;

  return (
    <div className="dev-deltas">
      {Object.keys(deltas.stats).length > 0 && (
        <div>
          stats:{' '}
          {Object.entries(deltas.stats)
            .map(([k, v]) => `${k} ${(v as number) >= 0 ? '+' : ''}${v}`)
            .join(', ')}
        </div>
      )}
      {deltas.inventoryAdded.length > 0 && (
        <div>
          inventory +:{' '}
          {deltas.inventoryAdded.map((i) => `${i.itemId}×${i.qty}`).join(', ')}
        </div>
      )}
      {deltas.flagsAdded.length > 0 && (
        <div>flags +: {deltas.flagsAdded.join(', ')}</div>
      )}
      {deltas.goldDelta !== 0 && <div>gold: {deltas.goldDelta}</div>}
      {deltas.loreAdded.length > 0 && (
        <div>lore +: {deltas.loreAdded.join(', ')}</div>
      )}
    </div>
  );
}

function NextLabel({ next }: { next: ScenarioStep['next'] }) {
  switch (next.kind) {
    case 'continueEvent':
      return <span>continueEvent → {next.eventId}</span>;
    case 'forceAscend':
      return <span>forceAscend</span>;
    case 'death':
      return <span className="dev-bad">DEATH</span>;
    case 'startCombat':
      return <span className="dev-warn">would trigger combat {next.combatId}</span>;
    case 'remainOnEvent':
      return <span>remainOnEvent</span>;
    case 'end':
      return <span>end ({next.reason})</span>;
  }
}

function SummaryBlock({ result }: { result: ScenarioResult }) {
  const s = result.summary;
  return (
    <div className="dev-summary">
      <h4 className="dev-sub-title">summary</h4>
      <table className="dev-summary-table">
        <tbody>
          <tr>
            <td>stats</td>
            <td>
              {Object.keys(s.statsDelta).length === 0
                ? '—'
                : Object.entries(s.statsDelta)
                    .map(([k, v]) => `${k} ${(v as number) >= 0 ? '+' : ''}${v}`)
                    .join(', ')}
            </td>
          </tr>
          <tr>
            <td>inventory</td>
            <td>
              {s.inventoryGained.length === 0
                ? '—'
                : s.inventoryGained.map((i) => `${i.itemId}×${i.qty}`).join(', ')}
            </td>
          </tr>
          <tr>
            <td>profile flags</td>
            <td>{s.profileFlagsAdded.length === 0 ? '—' : s.profileFlagsAdded.join(', ')}</td>
          </tr>
          <tr>
            <td>run flags</td>
            <td>{s.runFlagsAdded.length === 0 ? '—' : s.runFlagsAdded.join(', ')}</td>
          </tr>
          <tr>
            <td>banked gold</td>
            <td>{s.bankedGoldDelta === 0 ? '—' : s.bankedGoldDelta}</td>
          </tr>
          <tr>
            <td>lore</td>
            <td>{s.loreAdded.length === 0 ? '—' : s.loreAdded.join(', ')}</td>
          </tr>
          <tr>
            <td>final phase</td>
            <td>{s.finalPhase}</td>
          </tr>
          <tr>
            <td>combat</td>
            <td>{s.combatTriggered ?? '—'}</td>
          </tr>
          <tr>
            <td>survived</td>
            <td>{s.survived ? 'yes' : 'no'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
