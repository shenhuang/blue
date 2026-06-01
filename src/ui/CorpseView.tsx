import { useState } from 'react';
import type { GameState, DeathRecord, InventoryItem, DecayTier } from '@/types';
import { recoverFromCorpse } from '@/engine/death';
import { enterNodeSelection } from '@/engine/dive';
import { appendLog } from '@/engine/state';
import { getItemDef } from '@/engine/items';
import { renderDiverName, D_REVEAL_FLAG } from './diverName';
import { StatusBar } from './StatusBar';

function decayLabel(tier: DecayTier | undefined): { text: string; tone: string } {
  switch (tier) {
    case 'organic': return { text: '极易腐烂', tone: 'danger' };
    case 'consumable': return { text: '易损', tone: 'warn' };
    case 'material': return { text: '一般', tone: 'muted' };
    case 'durable': return { text: '耐久', tone: 'cyan' };
    case 'eternal': return { text: '永存', tone: 'violet' };
    default: return { text: '一般', tone: 'muted' };
  }
}

interface Props {
  state: GameState;
  deathRecordId: string;
  onStateChange: (s: GameState) => void;
}

export function CorpseView({ state, deathRecordId, onStateChange }: Props) {
  const record = state.profile.deaths.find((d) => d.id === deathRecordId);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  if (!record || !state.run) return null;
  const safeRecord = record;
  // 尸体上还能看到的物品 = snapshot 本身（衰减在 ageAndDecayDeaths 阶段已从 snapshot 移除）
  const recoverable = safeRecord.inventorySnapshot;
  // D-reveal：按累计死亡数 + 揭示 flag 故障化死者名（与 FuneralView 同一渲染）
  const shownName = renderDiverName(
    safeRecord.diverName,
    state.profile.deaths.length,
    state.profile.flags.has(D_REVEAL_FLAG),
  );

  function toggle(itemId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function handleTake() {
    const ids = [...selected];
    let s = recoverFromCorpse(state, deathRecordId, ids);
    s = appendLog(s, {
      tone: 'uncanny',
      text: `你从 ${shownName} 身上取走了 ${ids.length} 件物品。`,
    });
    s = enterNodeSelection(s);
    onStateChange(s);
  }

  function handleSayWords() {
    let s = state;
    s = { ...s, run: { ...s.run!, stats: { ...s.run!.stats, sanity: Math.min(100, s.run!.stats.sanity + 5) } } };
    s = appendLog(s, {
      tone: 'realistic',
      text: '你在尸体旁待了一会儿。水流很轻。你不知道说什么，但说了。理智 +5。',
    });
    s = enterNodeSelection(s);
    onStateChange(s);
  }

  function handleLeave() {
    let s = appendLog(state, { tone: 'realistic', text: '你绕过他，继续前行。' });
    s = enterNodeSelection(s);
    onStateChange(s);
  }

  return (
    <div className="dive">
      <StatusBar run={state.run} />
      <article className="event tone-uncanny">
        <h2 className="event-title">熟悉的轮廓</h2>
        <div className="event-body">
          <p>你认得这件潜水服。</p>
          <div className="corpse-tag">
            <div className="corpse-name">[ 潜水员 {record.diverName} ]</div>
            <div className="corpse-meta">
              死于 {record.depthAtDeath}m · {record.cause}
              <br />
              已在水下 {record.diveAge} 次出海
            </div>
          </div>
          <p className="dim">
            可以带走（背包剩余 {state.run.inventoryCapacity - state.run.inventory.length} 格）：
          </p>
        </div>

        {recoverable.length === 0 ? (
          <div className="dim">这具尸体已经没有什么可拿的了。</div>
        ) : (
          <ul className="corpse-items">
            {recoverable.map((item) => (
              <CorpseItemRow
                key={item.itemId}
                item={item}
                selected={selected.has(item.itemId)}
                onToggle={() => toggle(item.itemId)}
              />
            ))}
          </ul>
        )}

        <ul className="event-options">
          <li>
            <button
              className="btn event-option"
              onClick={handleTake}
              disabled={selected.size === 0}
            >
              拿走选定的 {selected.size} 件物品（氧气 −2）
            </button>
          </li>
          <li>
            <button className="btn event-option" onClick={handleSayWords}>
              说几句话再走（理智 +5，氧气 −1）
            </button>
          </li>
          <li>
            <button className="btn event-option dim" onClick={handleLeave}>
              不动他，走开
            </button>
          </li>
        </ul>
      </article>
    </div>
  );
}

function CorpseItemRow({
  item,
  selected,
  onToggle,
}: {
  item: InventoryItem;
  selected: boolean;
  onToggle: () => void;
}) {
  const def = getItemDef(item.itemId);
  const label = decayLabel(def?.decay);
  return (
    <li>
      <label className={`corpse-item ${selected ? 'selected' : ''}`}>
        <input type="checkbox" checked={selected} onChange={onToggle} />
        <span className="corpse-item-name">{def?.name ?? item.itemId}</span>
        <span className="corpse-item-qty">×{item.qty}</span>
        <span className={`decay-tag decay-${label.tone}`}>{label.text}</span>
      </label>
    </li>
  );
}

export function FuneralView({
  state,
  record,
  onReturn,
}: {
  state: GameState;
  record: DeathRecord;
  onReturn: () => void;
}) {
  // D-reveal：按累计死亡数 + 揭示 flag 故障化死者名
  const shownName = renderDiverName(
    record.diverName,
    state.profile.deaths.length,
    state.profile.flags.has(D_REVEAL_FLAG),
  );
  const goldText = record.goldAtDeath > 0 ? `${record.goldAtDeath} 金币` : '';
  const itemsText =
    record.inventorySnapshot.length > 0
      ? record.inventorySnapshot
          .map((i) => `${getItemDef(i.itemId)?.name ?? i.itemId}×${i.qty}`)
          .join('、')
      : '空背包';

  return (
    <div className="resolution funeral">
      <h2>[ {shownName} 没能回来 ]</h2>
      <div className="resolution-rows">
        <div>死于 {record.depthAtDeath}m</div>
        <div>{record.cause}</div>
      </div>
      <div className="funeral-prose">
        <p>{goldText && `身上的 ${goldText} 沉到海床。`}</p>
        <p>留在海里：{itemsText}</p>
        <p className="dim">下一次出海，或许有人能找到他。</p>
        <p className="dim">
          港口建设值 +{Math.max(2, Math.floor((Math.floor(record.depthAtDeath / 5) + 1) * 0.6))}
          ＝ 你死过的事，让活着的人变强。
        </p>
      </div>
      <button className="btn" onClick={onReturn}>
        回到港口
      </button>
      <div className="dim funeral-foot">
        累计 {state.profile.deaths.length} 次失踪 · 建设值 {state.profile.buildingPoints}
      </div>
    </div>
  );
}
