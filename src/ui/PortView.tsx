import { useState } from 'react';
import type { GameState, DialogNode, NpcDef } from '@/types';
import { getDialogNode, getNpc, selectChoice } from '@/engine/dialog';
import { evalCondition } from '@/engine/events';
import { toShop, toChart } from '@/engine/transitions';
import type { PortServiceMode } from './PortLayout';
import { DEV_TOOLS } from './devMode';

interface Props {
  state: GameState;
  onStateChange: (s: GameState) => void;
  /** 打开右栏服务面板（改装装备 / 打捞行会）——升级面板已移交 PortLayout 右栏（作者 06-13）；
   *  PortView 只负责「触发」，不再自渲染（对话仍留本视图＝左栏）。 */
  onOpenService: (mode: PortServiceMode) => void;
}

export function PortView({ state, onStateChange, onOpenService }: Props) {
  const aldo = getNpc('npc.aldo');
  const mira = getNpc('npc.mira');
  const [openDialog, setOpenDialog] = useState<DialogNode | null>(null);

  if (!aldo) return <div className="port">[资源缺失：npc.aldo]</div>;

  function startDialogWith(npc: NpcDef | undefined) {
    if (!npc) return;
    const root = getDialogNode(npc.dialogRoot.id) ?? npc.dialogRoot;
    setOpenDialog(root);
  }

  function handleChoice(choiceId: string) {
    if (!openDialog || !openDialog.choices) return;
    const choice = openDialog.choices.find((c) => c.id === choiceId);
    if (!choice) return;
    const { state: newState, next } = selectChoice(state, openDialog, choice);
    onStateChange(newState);
    // openShop / startDive 切换了 phase；这种情况 selectChoice 会返回 next=null
    setOpenDialog(next);
  }

  function openMiraShop() {
    setOpenDialog(null);
    onStateChange(toShop(state, 'mira.bench'));
  }

  function openChart() {
    setOpenDialog(null);
    onStateChange(toChart(state));
  }

  // 教学完成后，海图成为主出海入口；教学前只能走 Aldo 的资格潜水。
  // ?dev 下海图直接可开（作者 06-13·免做教程方便测试）；普通访客仍需 tutorial_complete。
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

      {!openDialog ? (
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
          <NpcCard name="Otto" role="气瓶师" description="正在给气瓶上压力，没抬头。" disabled />
          {chartUnlocked && (
            <button className="btn port-chart-btn" onClick={openChart}>
              摊开海图（出海）
            </button>
          )}
          <button
            className="btn port-upgrade-btn"
            onClick={() => onOpenService('gear')}
          >
            改装装备（材料 ＋ 金币）
          </button>
          <button
            className="btn port-chart-btn"
            onClick={() => onOpenService('bestiary')}
          >
            潜水志 · 图鉴
          </button>
        </div>
      ) : (
        <DialogPanel
          node={openDialog}
          state={state}
          onChoose={handleChoice}
          onClose={() => setOpenDialog(null)}
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
        {visibleChoices.length > 0 ? (
          visibleChoices.map((c) => (
            <button key={c.id} className="btn dialog-btn" onClick={() => onChoose(c.id)}>
              {c.label}
            </button>
          ))
        ) : (
          <button className="btn dialog-btn" onClick={onClose}>
            （离开）
          </button>
        )}
      </div>
    </div>
  );
}
