// Mira 的柜台 —— 把 profile.inventory 中可卖物品折成金币。
// eternal / story 类的不收（保留给剧情）；sellPrice <= 0 的也不收（如急救包）。

import { useState } from 'react';
import type { GameState } from '@/types';
import { getItemDef, allItems } from '@/engine/items';
import {
  buyFromMira,
  devGrantItem,
  listMiraBuyables,
  listMiraSellables,
  miraOfferFor,
  sellItemToMira,
  isSellableToMira,
} from '@/engine/port';
import { toPort } from '@/engine/transitions';
import { DEV_TOOLS } from './devMode';
import { ItemCell } from './ItemCell';
import { PanelShell } from './PanelShell';

interface Props {
  state: GameState;
  onStateChange: (s: GameState) => void;
}

export function MiraShopView({ state, onStateChange }: Props) {
  // 交易反馈（作者 2026-06-10「点了毫无反应」根治）：flash＝最近一笔买/卖；goldShort＝钱不够红字差额。
  const [flash, setFlash] = useState<string | null>(null);
  const [goldShort, setGoldShort] = useState<{ itemId: string; lack: number } | null>(null);
  // Dev 测试货架开合（#109）：默认收起——?dev 下也别让长长的全道具清单顶开正常柜台。
  const [devShelfOpen, setDevShelfOpen] = useState(false);
  const sellables = listMiraSellables(state.profile.inventory);
  const total = sellables.reduce((a, b) => a + b.total, 0);

  function handleDevGrant(itemId: string, qty: number) {
    const next = devGrantItem(state, itemId, qty);
    if (next !== state) {
      setFlash(`[dev] 白拿 ${getItemDef(itemId)?.name ?? itemId} ×${qty}（0 金）`);
      onStateChange(next);
    }
  }

  function handleSellOne(itemId: string) {
    const next = sellItemToMira(state, itemId, 1);
    if (next !== state) {
      const def = getItemDef(itemId);
      setFlash(`卖出 ${def?.name ?? itemId} ×1（+${miraOfferFor(itemId)} 金）`);
      setGoldShort(null);
      onStateChange(next);
    }
  }

  function handleSellEverything() {
    let s = state;
    let lines: string[] = [];
    for (const { item } of sellables) {
      const before = s.profile.bankedGold;
      s = sellItemToMira(s, item.itemId, item.qty);
      const gained = s.profile.bankedGold - before;
      if (gained > 0) {
        const def = getItemDef(item.itemId);
        lines.push(`${def?.name ?? item.itemId}×${item.qty} = ${gained}`);
      }
    }
    if (lines.length > 0) {
      setFlash(`全卖：${lines.join('、')}（共 +${s.profile.bankedGold - state.profile.bankedGold} 金）`);
      onStateChange(s);
    }
  }

  function handleBuyOne(itemId: string, unitPrice: number) {
    // 钱不够（作者要求可见提示·别再静默 no-op）：红字报差额，不动状态。
    if (state.profile.bankedGold < unitPrice) {
      setGoldShort({ itemId, lack: unitPrice - state.profile.bankedGold });
      setFlash(null);
      return;
    }
    const next = buyFromMira(state, itemId, 1);
    if (next !== state) {
      const def = getItemDef(itemId);
      setFlash(`买入 ${def?.name ?? itemId} ×1（−${unitPrice} 金）`);
      setGoldShort(null);
      onStateChange(next);
    }
  }

  function handleLeave() {
    onStateChange(toPort(state));
  }

  // 她的货架：Mira 卖的低阶材料 + 消耗品（T1/T2，带买价 + 剩余备货）
  const buyables = listMiraBuyables(state.profile);

  // 内容型界面统一壳（quirk #112）：银行金币（带跳动动画）固定在壳头、货架格子在中间滚、
  // 「离开柜台」钉底通栏——格子再多，余额和出口都不会被滚远。
  return (
    <div className="port mira-shop">
      <header className="port-header">
        <h1>Mira 的柜台</h1>
        <p className="port-sub">围裙永远沾着鳞片。盘秤就在手边。</p>
      </header>

      <PanelShell
        className="under-port-header"
        title="交易"
        sub={
          <>
            银行{' '}
            <span className="gold-figure" key={state.profile.bankedGold}>
              {state.profile.bankedGold}
            </span>{' '}
            金 ・ 仓库 {state.profile.inventory.length} 项
          </>
        }
        foot={
          <button className="btn" onClick={handleLeave}>
            离开柜台
          </button>
        }
      >
      {/* 交易系统（作者 2026-06-10 续拍「上=她的货点击买·下=我的柜点击卖」）：
          两块同构格子＋中间一条反馈（买/卖 flash + 钱不够红字差额）。
          买：货格点击买 1（售罄禁点·钱不够红显+点击报差额）；卖：柜格可卖品点击卖 1
          （格上标收价·她不收的惰性陈列带原因）；金币数字与柜格随交易跳动（key 重挂载）。 */}
      <section className="mira-section">
        <h3>她的货（点击买）</h3>
        <p className="dim mira-buy-note">浅水的常见材料，她手头有些存货。深处的东西只能自己下去拿。</p>
        <div className="item-grid">
          {buyables.map((b) => {
            const def = getItemDef(b.itemId);
            const soldOut = b.stock <= 0;
            const short = state.profile.bankedGold < b.unitPrice;
            return (
              <ItemCell
                key={b.itemId}
                def={def}
                itemId={b.itemId}
                note={soldOut ? '售罄' : `${b.unitPrice} 金 · 余 ${b.stock}`}
                disabled={soldOut}
                variant={short && !soldOut ? 'short' : undefined}
                title={
                  soldOut
                    ? `${def?.name ?? b.itemId}——她这批卖完了，下次回港再看`
                    : `${def?.name ?? b.itemId}——点击买 1（${b.unitPrice} 金）`
                }
                onClick={() => handleBuyOne(b.itemId, b.unitPrice)}
              />
            );
          })}
        </div>
        {goldShort && (
          <div className="mira-short-notice">
            钱不够买{getItemDef(goldShort.itemId)?.name ?? goldShort.itemId}：还差 {goldShort.lack} 金
            （银行 {state.profile.bankedGold} 金）。
          </div>
        )}
        {flash && <div className="mira-flash dim">{flash}</div>}
      </section>

      <section className="mira-section">
        <h3>你的储物柜（点击卖）</h3>
        {state.profile.inventory.filter((i) => i.qty > 0).length === 0 ? (
          <div className="dim">空的。海里什么都还没带回来。「下次再带东西来吧。」</div>
        ) : (
          <>
            <div className="item-grid live">
              {state.profile.inventory
                .filter((i) => i.qty > 0)
                .map((i) => {
                  const def = getItemDef(i.itemId);
                  const sellable = isSellableToMira(i.itemId);
                  if (!sellable) {
                    const why =
                      def?.decay === 'eternal'
                        ? '永存'
                        : def?.category === 'consumable'
                          ? '消耗品'
                          : def?.category === 'story'
                            ? '剧情物'
                            : '留用';
                    return (
                      <ItemCell
                        key={i.itemId}
                        cellKey={`${i.itemId}:${i.qty}`}
                        def={def}
                        itemId={i.itemId}
                        qty={i.qty}
                        note={`她不收 · ${why}`}
                        title={`${def?.name ?? i.itemId}——她不收这个（${why}）`}
                      />
                    );
                  }
                  const offer = miraOfferFor(i.itemId);
                  return (
                    <ItemCell
                      key={i.itemId}
                      cellKey={`${i.itemId}:${i.qty}`}
                      def={def}
                      itemId={i.itemId}
                      qty={i.qty}
                      note={`卖 ${offer} 金`}
                      title={`${def?.name ?? i.itemId}——点击卖 1（+${offer} 金）`}
                      onClick={() => handleSellOne(i.itemId)}
                    />
                  );
                })}
            </div>
            {sellables.length > 0 && (
              <div className="mira-total-row">
                <span>可卖合计 {total} 金</span>
                <button className="btn" onClick={handleSellEverything}>
                  全卖给她（+{total}）
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* Dev 测试货架（#109·作者要求）：?dev 门后（quirk #97 同款门）·0 元白拿全部道具进仓库——
          验收/测试用（如猎手 decoy 流不用先攒 48 金）。真经济零触碰（devGrantItem 不动金币/备货）；
          普通访客 DEV_TOOLS=false 整段不渲染。 */}
      {DEV_TOOLS && (
        <section className="mira-section mira-dev-shelf">
          <h3>测试货架（dev）</h3>
          {devShelfOpen ? (
            <>
              <p className="dim">0 元、全道具、直接进仓库。仅 ?dev 可见——别在这儿找游戏平衡。</p>
              <ul className="mira-items">
                {allItems().map((def) => (
                  <li key={def.id} className="mira-item">
                    <div className="mira-item-info">
                      <span className="mira-item-name">{def.name}</span>
                      <span className="dim">{def.id}</span>
                    </div>
                    <div className="mira-item-actions">
                      <button className="btn small" onClick={() => handleDevGrant(def.id, 1)}>
                        拿 1（0 金）
                      </button>
                      <button className="btn small" onClick={() => handleDevGrant(def.id, 5)}>
                        拿 5
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <button className="btn small" onClick={() => setDevShelfOpen(false)}>
                收起测试货架
              </button>
            </>
          ) : (
            <button className="btn small" onClick={() => setDevShelfOpen(true)}>
              打开测试货架（0 元全道具）
            </button>
          )}
        </section>
      )}

      </PanelShell>
    </div>
  );
}

