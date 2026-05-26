import { useState } from 'react';
import type { GameState, DialogNode } from '@/types';
import { getDialogNode, getNpc, selectChoice } from '@/engine/dialog';
import { evalCondition } from '@/engine/events';

interface Props {
  state: GameState;
  onStateChange: (s: GameState) => void;
}

export function PortView({ state, onStateChange }: Props) {
  // 教学关入口：先把 Aldo 设为唯一可对话 NPC
  const aldo = getNpc('npc.aldo');
  const [openDialog, setOpenDialog] = useState<DialogNode | null>(null);

  if (!aldo) return <div className="port">[资源缺失：npc.aldo]</div>;

  function startDialogWith(npc: ReturnType<typeof getNpc>) {
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
    setOpenDialog(next);
  }

  return (
    <div className="port">
      <header className="port-header">
        <h1>鸢尾湾</h1>
        <p className="port-sub">黎明前的港口。雾还没散。</p>
        <div className="port-meta">
          建设值 {state.profile.buildingPoints} ・ 银行 {state.profile.bankedGold} 金币
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
          <NpcCard name="Mira" role="打捞商" description="柜台还没开。" disabled />
          <NpcCard name="Otto" role="气瓶师" description="正在给气瓶上压力，没抬头。" disabled />
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
}: {
  name: string;
  role: string;
  description: string;
  onTalk?: () => void;
  disabled?: boolean;
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
