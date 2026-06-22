import { useEffect } from 'react';
import { CHANGELOG } from '@/data/changelog';

// 面向玩家的更新日志弹窗 —— 由全局页脚「版本号」点开（App.tsx）。
// 纯展示：不读写 GameState、不碰 engine，只截取 data/changelog.ts 最近 VISIBLE 条。
// 数据全量保留在 data 文件里，UI 只显示最近几条（作者定：5 条·可滚动）。
const VISIBLE = 5;

interface Props {
  onClose: () => void;
}

export function ChangelogModal({ onClose }: Props) {
  // Esc 关闭（弹窗惯例）
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const entries = CHANGELOG.slice(0, VISIBLE);

  return (
    // 点遮罩关闭；点卡片本身 stopPropagation 不关
    <div className="changelog-overlay" onClick={onClose}>
      <div
        className="changelog-modal"
        role="dialog"
        aria-modal="true"
        aria-label="更新日志"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="changelog-head">
          <div className="changelog-title">更新日志</div>
          <button className="icon-close" type="button" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="changelog-body">
          {entries.map((entry) => (
            <div className="changelog-entry" key={entry.date + (entry.title ?? '')}>
              <div className="changelog-entry-head">
                <span className="changelog-date">{entry.date}</span>
                {entry.title && (
                  <span className="changelog-entry-title">{entry.title}</span>
                )}
              </div>
              <ul className="changelog-changes">
                {entry.changes.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="changelog-foot">深海回响 · 仍在打磨中，欢迎反馈</div>
      </div>
    </div>
  );
}
