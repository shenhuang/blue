// Silas 的货架 —— 特殊商人（藏宝贸易与信任系统 SPEC §6·Phase 2 MVP）。
// 与 MiraShopView 平行但故意不共享组件：只花深潮币（item.deep_token）、按信任档二次门控、
// 无「卖东西」侧（他只买他要的，不收摊·SPEC §6.3 只谈货架，未提回购）。

import { useState } from 'react';
import type { GameState } from '@/types';
import { getItemDef } from '@/engine/items';
import { getNpc } from '@/engine/dialog';
import { trustTier, trustValue } from '@/engine/trust';
import {
  buyFromSpecialMerchant,
  listSpecialMerchantShelf,
  SPECIAL_MERCHANT_NPC_ID,
} from '@/engine/port';
import { toPort } from '@/engine/transitions';
import { ItemCell } from './ItemCell';
import { PanelShell } from './PanelShell';

interface Props {
  state: GameState;
  onStateChange: (s: GameState) => void;
}

export function SpecialMerchantShopView({ state, onStateChange }: Props) {
  const [flash, setFlash] = useState<string | null>(null);
  const npc = getNpc(SPECIAL_MERCHANT_NPC_ID);
  const tokenCount = state.profile.inventory.find((i) => i.itemId === 'item.deep_token')?.qty ?? 0;
  const tier = trustTier(state.profile, SPECIAL_MERCHANT_NPC_ID);
  const value = trustValue(state.profile, SPECIAL_MERCHANT_NPC_ID);
  const shelf = listSpecialMerchantShelf(state.profile);

  function handleBuyOne(itemId: string, tokens: number) {
    if (tokenCount < tokens) {
      setFlash(`深潮币不够：还差 ${tokens - tokenCount} 枚`);
      return;
    }
    const next = buyFromSpecialMerchant(state, itemId, 1);
    if (next !== state) {
      const def = getItemDef(itemId);
      setFlash(`买入 ${def?.name ?? itemId} ×1（−${tokens} 深潮币）`);
      onStateChange(next);
    }
  }

  function handleLeave() {
    onStateChange(toPort(state));
  }

  return (
    <div className="port silas-shop">
      <header className="port-header">
        <h1>{npc?.name ?? 'Silas'} 的货架</h1>
        <p className="port-sub">{npc?.shortDescription ?? '不常在，来的时候别问他从哪儿来。'}</p>
      </header>

      <PanelShell
        className="under-port-header"
        title="交易"
        sub={
          <>
            深潮币 <span className="gold-figure" key={tokenCount}>{tokenCount}</span> 枚 ・ 信任
            第 {tier} 档（{value}）
          </>
        }
        onClose={handleLeave}
      >
        <section className="mira-section">
          <p className="dim mira-buy-note">
            只收深潮币，不收金币。信任不够的货先摆着——不是没有，是他不给你看。
          </p>
          <div className="item-grid">
            {shelf.map((s) => {
              const def = getItemDef(s.itemId);
              const soldOut = s.stock <= 0;
              const short = tokenCount < s.tokens;
              const blocked = s.locked || soldOut;
              const note = s.locked
                ? `未达信任 ${s.minTrustTier} 档`
                : soldOut
                  ? '售罄'
                  : `${s.tokens} 枚 · 余 ${s.stock}`;
              return (
                <ItemCell
                  key={s.itemId}
                  def={def}
                  itemId={s.itemId}
                  note={note}
                  disabled={blocked}
                  variant={short && !blocked ? 'short' : undefined}
                  title={
                    s.locked
                      ? `${def?.name ?? s.itemId}——信任不够，他不给你看这件`
                      : soldOut
                        ? `${def?.name ?? s.itemId}——这批没了，下次再看`
                        : `${def?.name ?? s.itemId}——点击买 1（${s.tokens} 深潮币）`
                  }
                  onClick={() => handleBuyOne(s.itemId, s.tokens)}
                />
              );
            })}
          </div>
          {flash && <div className="mira-flash dim">{flash}</div>}
        </section>
      </PanelShell>
    </div>
  );
}
