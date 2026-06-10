// Mira 的柜台 —— 把 profile.inventory 中可卖物品折成金币。
// eternal / story 类的不收（保留给剧情）；sellPrice <= 0 的也不收（如急救包）。

import { useState } from 'react';
import type { GameState, InventoryItem } from '@/types';
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

interface Props {
  state: GameState;
  onStateChange: (s: GameState) => void;
}

export function MiraShopView({ state, onStateChange }: Props) {
  const [flash, setFlash] = useState<string | null>(null);
  // 买入侧反馈（作者 2026-06-10「点了毫无反应」）：成功＝flash + 储物柜对应格跳动；钱不够＝红字差额。
  const [buyFlash, setBuyFlash] = useState<string | null>(null);
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
      onStateChange(next);
    }
  }

  function handleSellAll(itemId: string, qty: number) {
    const next = sellItemToMira(state, itemId, qty);
    if (next !== state) {
      const def = getItemDef(itemId);
      setFlash(`卖出 ${def?.name ?? itemId} ×${qty}（+${miraOfferFor(itemId) * qty} 金）`);
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
      setBuyFlash(null);
      return;
    }
    const next = buyFromMira(state, itemId, 1);
    if (next !== state) {
      const def = getItemDef(itemId);
      setBuyFlash(`买入 ${def?.name ?? itemId} ×1（−${unitPrice} 金）`);
      setGoldShort(null);
      onStateChange(next);
    }
  }

  function handleLeave() {
    onStateChange(toPort(state));
  }

  // 回购侧：Mira 卖的低阶材料（T1/T2，带买价 + 剩余备货）
  const buyables = listMiraBuyables(state.profile);

  // 不卖品（剧情物、急救包等）单列展示
  const keepers = state.profile.inventory.filter(
    (i) => i.qty > 0 && !isSellableToMira(i.itemId),
  );

  return (
    <div className="port mira-shop">
      <header className="port-header">
        <h1>Mira 的柜台</h1>
        <p className="port-sub">围裙永远沾着鳞片。盘秤就在手边。</p>
        <div className="port-meta">
          银行 {state.profile.bankedGold} 金币 ・ 仓库 {state.profile.inventory.length} 项
        </div>
      </header>

      <section className="mira-section">
        <h3>她要的</h3>
        {sellables.length === 0 ? (
          <div className="dim">柜台上是空的。「下次再带东西来吧。」</div>
        ) : (
          <ul className="mira-items">
            {sellables.map(({ item, unitPrice, total }) => (
              <MiraSellRow
                key={item.itemId}
                item={item}
                unitPrice={unitPrice}
                total={total}
                onSellOne={() => handleSellOne(item.itemId)}
                onSellAll={() => handleSellAll(item.itemId, item.qty)}
              />
            ))}
          </ul>
        )}
        {sellables.length > 0 && (
          <div className="mira-total-row">
            <span>合计 {total} 金</span>
            <button className="btn" onClick={handleSellEverything}>
              全卖给她（+{total}）
            </button>
          </div>
        )}
        {flash && <div className="mira-flash dim">{flash}</div>}
      </section>

      {/* 回购侧（作者 2026-06-10 改拍「图标陈列 + 可见反馈」）：货架格子点击即买；
          钱不够＝点击给红字差额（不再静默）；成功＝flash + 下方储物柜对应格跳动 + 金币跳动。 */}
      <section className="mira-section">
        <h3>
          她也匀给你（回购）
          <span className="mira-gold dim">
            　银行 <span className="gold-figure" key={state.profile.bankedGold}>{state.profile.bankedGold}</span> 金
          </span>
        </h3>
        <p className="dim mira-buy-note">浅水的常见材料，她手头有些存货。深处的东西只能自己下去拿。点货格买一件。</p>
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
        {buyFlash && <div className="mira-flash dim">{buyFlash}</div>}
      </section>

      {/* 储物柜一览（作者 2026-06-10「储物柜也陈列、因购买增加对应物品」）：纯陈列；
          cellKey 带数量 → 买入后对应格重挂载跳一下（item-pop）＝「东西确实进来了」。 */}
      <section className="mira-section">
        <h3>你的储物柜</h3>
        {state.profile.inventory.filter((i) => i.qty > 0).length === 0 ? (
          <div className="dim">空的。海里什么都还没带回来。</div>
        ) : (
          <div className="item-grid live">
            {state.profile.inventory
              .filter((i) => i.qty > 0)
              .map((i) => (
                <ItemCell
                  key={i.itemId}
                  cellKey={`${i.itemId}:${i.qty}`}
                  def={getItemDef(i.itemId)}
                  itemId={i.itemId}
                  qty={i.qty}
                />
              ))}
          </div>
        )}
      </section>

      {keepers.length > 0 && (
        <section className="mira-section">
          <h3>她不收</h3>
          <ul className="mira-items">
            {keepers.map((item) => (
              <KeeperRow key={item.itemId} item={item} />
            ))}
          </ul>
        </section>
      )}

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

      <button className="btn" onClick={handleLeave}>
        离开柜台
      </button>
    </div>
  );
}

function MiraSellRow({
  item,
  unitPrice,
  total,
  onSellOne,
  onSellAll,
}: {
  item: InventoryItem;
  unitPrice: number;
  total: number;
  onSellOne: () => void;
  onSellAll: () => void;
}) {
  const def = getItemDef(item.itemId);
  return (
    <li className="mira-item">
      <div className="mira-item-info">
        <span className="mira-item-name">{def?.name ?? item.itemId}</span>
        <span className="mira-item-qty">×{item.qty}</span>
        <span className="dim">@ {unitPrice} 金 = {total}</span>
      </div>
      <div className="mira-item-actions">
        <button className="btn small" onClick={onSellOne}>
          卖 1
        </button>
        {item.qty > 1 && (
          <button className="btn small" onClick={onSellAll}>
            卖完（×{item.qty}）
          </button>
        )}
      </div>
    </li>
  );
}

function KeeperRow({ item }: { item: InventoryItem }) {
  const def = getItemDef(item.itemId);
  const note =
    def?.decay === 'eternal'
      ? '永存'
      : def?.category === 'consumable'
      ? '消耗品'
      : def?.category === 'story'
      ? '剧情物'
      : '留用';
  return (
    <li className="mira-item dim">
      <div className="mira-item-info">
        <span className="mira-item-name">{def?.name ?? item.itemId}</span>
        <span className="mira-item-qty">×{item.qty}</span>
        <span className="decay-tag decay-muted">{note}</span>
      </div>
    </li>
  );
}
