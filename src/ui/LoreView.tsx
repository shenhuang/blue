// 见闻/生态志图鉴（Lore codex）—— 港口「潜水志 · 见闻」服务面板（#137）。
//
// 设计（沿 BestiaryView 套路·作者 2026-06-14 拍的图鉴口径）：
//   - 只显示玩家**已记录**的见闻（profile.loreEntries·事件 outcome.loreEntry 写入）——守发现感
//     与剧透红线（quirk #117）。不露总数，只报「已记录 N 则」。
//   - 显示文案来自注册表（engine/lore.ts ← src/data/lore.json）；未登记的 id 跳过不显示（不崩）。
//
// 边界：依赖单向 ui→engine（读 allLoreEntries·check-boundaries 规则一）；不构造 phase（规则二）；
//   滚动交给 PanelShell 的 .panel-shell-body（规则三·quirk #112）。入口在 PortLayout 右栏
//   （PortServiceMode 'lore'）。

import type { GameState } from '@/types';
import { allLoreEntries, type LoreEntryDef } from '@/engine/lore';
import { PanelShell } from './PanelShell';

interface Props {
  state: GameState;
  onClose: () => void;
}

export function LoreView({ state, onClose }: Props) {
  const recorded = state.profile.loreEntries ?? new Set<string>();
  const seen = allLoreEntries().filter((e) => recorded.has(e.id));

  return (
    <PanelShell
      title="潜水志 · 见闻"
      sub={<>已记录 {seen.length} 则</>}
      foot={
        <button type="button" className="btn" onClick={onClose}>
          返回
        </button>
      }
    >
      {seen.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.8 }}>
          还没有记下什么。
          <br />
          下潜，看见，活着回来——你记下的东西会出现在这一页。
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {seen.map((e) => (
            <LoreCard key={e.id} def={e} />
          ))}
        </div>
      )}
    </PanelShell>
  );
}

function LoreCard({ def }: { def: LoreEntryDef }) {
  return (
    <article
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--border)',
        borderLeft: '3px solid var(--accent)',
        borderRadius: 6,
        padding: '12px 14px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text)' }}>{def.title}</h3>
        {def.group && (
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{def.group}</span>
        )}
      </div>
      {def.body.split('\n').map((line, i) => (
        <p key={i} style={{ margin: '8px 0 0', lineHeight: 1.7, color: 'var(--text)' }}>
          {line}
        </p>
      ))}
    </article>
  );
}
