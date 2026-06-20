// 升级效果「当前 → 之后」统一对比（作者 2026-06-20·#5·三处升级统一显示模型）。
// 装备(EquipmentEffect) / 灯塔(LighthouseEffect) / 打捞·全局(UpgradeEffect) 各自把 effects 归一化成 EffectSet
// 喂本组件——**数值项前后对比**〔提升变绿 + ↑〕、**解锁项**作为「+ 新增」绿行（只显本级相对上一级新加的）。
// 边界：src/ui·纯展示·**不认 effect kind**（只收已归一化的 EffectSet·解耦三套 effect 类型·账单 UI 用 UpgradeCostView·这是效果 UI）。
//
// EffectSet：数值项 stats（label 作匹配键·跨 before/after 对齐·render 格式化「合并求和后」的值）、解锁项 unlocks（文案）。
// 注：数值统一「越大越好」语义（绿↑＝after > before）；越大越坏的项（如灯塔 energyDraw）归一化时**别放进 stats**（在面板侧跳过）。

export interface StatLine {
  /** 匹配键（同系统内同一 stat 用同 label·跨 before/after / 合并对齐）。 */
  label: string;
  /** 数值（比大小判提升·绿↑）。 */
  value: number;
  /** 显示文本（格式化「合并求和后」的值·如「氧气上限 +60」「背包格 +1」「能源产出 +2」）。 */
  render: (v: number) => string;
}

export interface EffectSet {
  stats: StatLine[];
  unlocks: string[];
}

export function emptyEffectSet(): EffectSet {
  return { stats: [], unlocks: [] };
}

/** 合并若干 EffectSet：同 label 数值相加（render 取首个·同 label 应同 render 规则）·unlocks 并集（去重保序）。 */
export function mergeEffectSets(...sets: EffectSet[]): EffectSet {
  const statMap = new Map<string, StatLine>();
  const unlocks: string[] = [];
  for (const s of sets) {
    for (const st of s.stats) {
      const prev = statMap.get(st.label);
      statMap.set(st.label, prev ? { ...prev, value: prev.value + st.value } : { ...st });
    }
    for (const u of s.unlocks) if (!unlocks.includes(u)) unlocks.push(u);
  }
  return { stats: [...statMap.values()], unlocks };
}

export function UpgradeEffectDelta({
  before,
  after,
  beforeLabel,
  afterLabel,
  build = false,
  buildLabel = '建造',
}: {
  before: EffectSet;
  after: EffectSet;
  beforeLabel: string;
  afterLabel: string;
  /** 从基线（before 空·第一级 / 打造）：只显左边**一个框**「建造获得的内容」·无对比·无箭头（作者 2026-06-20·#6）。 */
  build?: boolean;
  /** build 态的框标签（缺省「建造」；装备打造传「打造」）。 */
  buildLabel?: string;
}) {
  if (build) {
    if (after.stats.length === 0 && after.unlocks.length === 0) return null;
    return (
      <div className="equip-stat-compare build">
        <div className="equip-stat-col">
          <span className="equip-stat-col-label dim">{buildLabel}</span>
          {after.stats.map((s) => (
            <span key={s.label} className="equip-stat-line">{s.render(s.value)}</span>
          ))}
          {after.unlocks.map((u) => (
            <span key={u} className="equip-stat-line">{u}</span>
          ))}
        </div>
      </div>
    );
  }
  const bMap = new Map(before.stats.map((s) => [s.label, s]));
  const aMap = new Map(after.stats.map((s) => [s.label, s]));
  const labels = [...new Set([...bMap.keys(), ...aMap.keys()])];
  const newUnlocks = after.unlocks.filter((u) => !before.unlocks.includes(u));
  // 无数值项、无新解锁 → 不渲染（如灯塔深度柱探深轨 effects 空·只门控）。
  if (labels.length === 0 && newUnlocks.length === 0) return null;
  return (
    <div className="equip-stat-compare">
      <div className="equip-stat-col">
        <span className="equip-stat-col-label dim">{beforeLabel}</span>
        {labels.map((l) => {
          const s = bMap.get(l);
          return (
            <span key={l} className="equip-stat-line">{s ? s.render(s.value) : '—'}</span>
          );
        })}
      </div>
      <div className="equip-stat-arrow" aria-hidden="true">→</div>
      <div className="equip-stat-col">
        <span className="equip-stat-col-label dim">{afterLabel}</span>
        {labels.map((l) => {
          const b = bMap.get(l);
          const a = aMap.get(l);
          const up = (a?.value ?? 0) > (b?.value ?? 0);
          return (
            <span key={l} className={`equip-stat-line ${up ? 'up' : ''}`}>
              {a ? a.render(a.value) : '—'}
              {up ? ' ↑' : ''}
            </span>
          );
        })}
        {newUnlocks.map((u) => (
          <span key={u} className="equip-stat-line up">+ {u}</span>
        ))}
      </div>
    </div>
  );
}
