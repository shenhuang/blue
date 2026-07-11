import { useEffect, useState } from 'react';
import type { GameState, DialogNode, NpcDef } from '@/types';
import { getDialogNode, getNpc, selectChoice, selectDisplayChoices } from '@/engine/dialog';
import { evalCondition } from '@/engine/events';
import { toShop, toChart } from '@/engine/transitions';
import type { PortServiceMode } from './portFocus';
import { DEV_TOOLS } from './devMode';

interface Props {
  state: GameState;
  onStateChange: (s: GameState) => void;
  /** 打开右栏服务面板（改装装备 / 打捞行会 / 图鉴）——升级面板已移交 PortLayout 右栏（作者 06-13）；
   *  PortView 只负责「触发」，不再自渲染（对话仍留本视图＝左栏）。 */
  onOpenService: (mode: PortServiceMode) => void;
  /** 当前打开的港口对话节点（null＝没在对话·显示 NPC 列表）。态由 PortLayout 持有（互斥单点·见 portFocus）。 */
  dialog: DialogNode | null;
  /** 改动对话节点（开新对话 / 推进 / 关闭 null）。PortLayout 在此收口互斥：开对话即收右栏服务界面。 */
  onDialogChange: (node: DialogNode | null) => void;
}

export function PortView({ state, onStateChange, onOpenService, dialog, onDialogChange }: Props) {
  const aldo = getNpc('npc.aldo');
  const mira = getNpc('npc.mira');
  const otto = getNpc('npc.otto');

  if (!aldo) return <div className="port">[资源缺失：npc.aldo]</div>;

  function startDialogWith(npc: NpcDef | undefined) {
    if (!npc) return;
    const root = getDialogNode(npc.dialogRoot.id) ?? npc.dialogRoot;
    onDialogChange(root);
  }

  function handleChoice(choiceId: string) {
    if (!dialog || !dialog.choices) return;
    const choice = dialog.choices.find((c) => c.id === choiceId);
    if (!choice) return;
    const { state: newState, next } = selectChoice(state, dialog, choice);
    onStateChange(newState);
    // openShop / startDive 切换了 phase；这种情况 selectChoice 会返回 next=null
    onDialogChange(next);
  }

  function openMiraShop() {
    onDialogChange(null);
    onStateChange(toShop(state, 'mira.bench'));
  }

  function openChart() {
    onDialogChange(null);
    onStateChange(toChart(state));
  }

  // 教学完成后，海图成为主出海入口；教学前只能走 Aldo 的资格潜水。
  // dev 跳过教学开图：**只认显式 ?dev**（不认 npm-dev 的 import.meta.env.DEV／DEV_TOOLS——否则本地
  // dev server 教学前就能开图＝作者 2026-06-14 报「非 dev 也能不教学开图」）。线上/本地无 ?dev 一律须 tutorial_complete。
  const chartUnlocked = state.profile.flags.has('flag.tutorial_complete') || DEV_TOOLS;

  return (
    <div className="port">
      <header className="port-header">
        <h1>鸢尾湾</h1>
        <p className="port-sub">黎明前的港口。雾还没散。</p>
        <div className="port-meta">
          银行 {state.profile.bankedGold} 金币
          {state.profile.inventory.length > 0 && (
            <> ・ 仓库 {state.profile.inventory.length} 项</>
          )}
        </div>
      </header>

      {!dialog ? (
        <>
          {/* NPC 卡片区＝随页滚动（卡片多了不挤掉底部操作）；出口按钮在下方 .port-actions 常驻。 */}
          <div className="port-npcs">
            <NpcCard
              name={aldo.name}
              role="守灯人"
              description={aldo.shortDescription}
              onTalk={() => startDialogWith(aldo)}
            />
            {mira ? (
              <NpcCard
                name={mira.name}
                role="打捞商"
                description={mira.shortDescription}
                onTalk={() => startDialogWith(mira)}
                extraAction={{ label: '直接找她卖东西', onClick: openMiraShop }}
                extraAction2={{ label: '打捞行会（升级服务）', onClick: () => onOpenService('salvage') }}
              />
            ) : (
              <NpcCard name="Mira" role="打捞商" description="柜台还没开。" disabled />
            )}
            {otto ? (
              <NpcCard
                name={otto.name}
                role="气瓶师"
                description={otto.shortDescription}
                onTalk={() => startDialogWith(otto)}
                extraAction={{ label: '改装装备', onClick: () => onOpenService('upgrade') }}
              />
            ) : (
              <NpcCard name="Otto" role="气瓶师" description="仓库门口没人。" disabled />
            )}
          </div>
          {/* 常驻底部出口（作者 2026-06-19「物品栏/海图固定显示·海图置底」）：sticky 钉视区底·NPC 区随页滚。 */}
          <div className="port-actions">
            <button className="btn port-upgrade-btn" onClick={() => onOpenService('locker')}>
              物品栏
            </button>
            {chartUnlocked && (
              <button className="btn port-chart-btn" onClick={openChart}>
                摊开海图（出海）
              </button>
            )}
          </div>
        </>
      ) : (
        <DialogPanel
          node={dialog}
          state={state}
          onChoose={handleChoice}
          onClose={() => onDialogChange(null)}
        />
      )}
    </div>
  );
}

function NpcCard({
  name,
  role,
  description,
  onTalk,
  disabled,
  extraAction,
  extraAction2,
}: {
  name: string;
  role: string;
  description: string;
  onTalk?: () => void;
  disabled?: boolean;
  extraAction?: { label: string; onClick: () => void };
  extraAction2?: { label: string; onClick: () => void };
}) {
  return (
    <div className={`npc-card ${disabled ? 'disabled' : ''}`}>
      <div className="npc-name">{name}</div>
      <div className="npc-role">{role}</div>
      <div className="npc-desc">{description}</div>
      {!disabled && onTalk && (
        <button className="btn" onClick={onTalk}>
          上前打招呼
        </button>
      )}
      {!disabled && extraAction && (
        <button className="btn" onClick={extraAction.onClick}>
          {extraAction.label}
        </button>
      )}
      {!disabled && extraAction2 && (
        <button className="btn" onClick={extraAction2.onClick}>
          {extraAction2.label}
        </button>
      )}
    </div>
  );
}

function DialogPanel({
  node,
  state,
  onChoose,
  onClose,
}: {
  node: DialogNode;
  state: GameState;
  onChoose: (id: string) => void;
  onClose: () => void;
}) {
  const visibleChoices = (node.choices ?? []).filter((c) => {
    if (!c.visibleIf) return true;
    return evalCondition(state, c.visibleIf);
  });

  // 选项面板收窄（超过 DIALOG_DISPLAY_CAP 条才收窄+换话题·作者 2026-07-03 拍板）：换节点时取确定顺序，
  // 只有点了「换个话题」才真随机重抽——不然节点内无关的 state 变化会打断玩家正在看的选项。
  const [selection, setSelection] = useState(() =>
    selectDisplayChoices(state.profile, node, visibleChoices, false)
  );

  useEffect(() => {
    setSelection(selectDisplayChoices(state.profile, node, visibleChoices, false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  function handleRotate() {
    setSelection(selectDisplayChoices(state.profile, node, visibleChoices, true));
  }

  return (
    <div className="dialog-panel">
      {node.text && (
        <div className="dialog-text">
          {node.text.split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
      <div className="dialog-choices">
        {selection.shown.length > 0 ? (
          selection.shown.map((c) => {
            const isSeen = state.profile.seenChoices?.has(`${node.id}::${c.id}`) ?? false;
            return (
              <button
                key={c.id}
                className={`btn dialog-btn${isSeen ? ' dialog-btn-seen' : ''}`}
                onClick={() => onChoose(c.id)}
              >
                {c.label}
              </button>
            );
          })
        ) : (
          <button className="btn dialog-btn" onClick={onClose}>
            （离开）
          </button>
        )}
        {selection.needsRotate && (
          <button className="btn dialog-btn dialog-rotate-btn" onClick={handleRotate}>
            换个话题聊聊
          </button>
        )}
      </div>
    </div>
  );
}
