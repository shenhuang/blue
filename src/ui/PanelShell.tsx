// 内容型界面统一壳（2026-06-10 作者拍板·quirk #112）：头部状态固定 + 中间内容滚动。
//
// 为什么是组件而不是散文约定：内容随游戏数据增长的视图（修缮线/货架格/设施轨…）一旦整页滚，
// 金币等状态与「关闭」出口会被滚得很远，通用交互劣化。壳把结构钉死——新内容视图用壳即自动获得正确行为；
// styles.css 的 overflow-y 白名单检查（check-boundaries 规则三）反向兜底：谁绕开壳自己写滚动容器，regress 会红。
//
// 关闭收口（2026-06-18 作者拍板「统一·在框内·位置一致」）：关闭＝头部**右上角 ✕**（onClose·单一来源），
// 替代旧的「底部 foot 返回/离开」——所有用壳的面板（改装/商店/图鉴/见闻/设施/物品栏详情）关闭位置一致。
// 缺省 onClose＝不显 ✕（整页替换式视图自有出口）。
//
// 高度预算：壳 max-height = 视口高 − var(--shell-outside)（壳外 chrome：app 边距 + 页眉等）。
// 视口用 dvh（手机地址栏伸缩安全）+ vh 兜底；嵌在页眉下的场景用 className 覆盖变量（如 .under-port-header）。
// 内容不足时壳随内容收缩（不设 min-height）。

import type { ReactNode } from 'react';

interface Props {
  /** 面板题（如「改装装备」）。 */
  title: string;
  /** 头部状态行（金币等·要随交易跳就传带 key 的节点）。 */
  sub?: ReactNode;
  /** 右上角 ✕ 关闭（统一·替代旧底部 foot·缺省＝不显关闭）。 */
  onClose?: () => void;
  /** 会增长的内容——在中间滚动栏里滚。 */
  children: ReactNode;
  /** 附加根类：覆盖 --shell-outside 预算（.under-port-header）或视图专属样式。 */
  className?: string;
}

export function PanelShell({ title, sub, onClose, children, className }: Props) {
  return (
    <div className={className ? `panel-shell ${className}` : 'panel-shell'}>
      <div className="panel-shell-head">
        <div className="panel-shell-titles">
          <div className="panel-shell-title">{title}</div>
          {sub != null && <div className="panel-shell-sub">{sub}</div>}
        </div>
        {onClose && (
          <button type="button" className="icon-close panel-shell-close" onClick={onClose} aria-label="返回">
            ✕
          </button>
        )}
      </div>
      <div className="panel-shell-body">{children}</div>
    </div>
  );
}
