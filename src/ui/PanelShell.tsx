// 内容型界面统一壳（2026-06-10 作者拍板·quirk #112）：头部状态固定 + 中间内容滚动 + 底部出口通栏。
//
// 为什么是组件而不是散文约定：内容随游戏数据增长的视图（修缮线/货架格/设施轨…）一旦整页滚，
// 金币等状态与「返回/离开」出口会被滚得很远，通用交互劣化。壳把三段结构钉死——新内容视图
// 用壳即自动获得正确行为；styles.css 的 overflow-y 白名单检查（check-boundaries 规则三）反向兜底：
// 谁绕开壳自己写滚动容器，regress 会红。
//
// 高度预算：壳 max-height = 视口高 − var(--shell-outside)（壳外 chrome：app 边距 + 页眉等）。
// 视口用 dvh（手机地址栏伸缩安全）+ vh 兜底；嵌在页眉下的场景用 className 覆盖变量
// （如 .under-port-header）。内容不足时壳随内容收缩（不设 min-height），出口紧跟内容，
// 与小内容页面观感一致——所以小视图不必硬迁壳。

import type { ReactNode } from 'react';

interface Props {
  /** 面板题（如「港口修缮」）。 */
  title: string;
  /** 头部状态行（金币等·要随交易跳就传带 key 的节点）。 */
  sub?: ReactNode;
  /** 底部出口（返回/离开按钮·通栏·与各页跳转操作对齐）。 */
  foot: ReactNode;
  /** 会增长的内容——在中间滚动栏里滚。 */
  children: ReactNode;
  /** 附加根类：覆盖 --shell-outside 预算（.under-port-header）或视图专属样式。 */
  className?: string;
}

export function PanelShell({ title, sub, foot, children, className }: Props) {
  return (
    <div className={className ? `panel-shell ${className}` : 'panel-shell'}>
      <div className="panel-shell-head">
        <div className="panel-shell-title">{title}</div>
        {sub != null && <div className="panel-shell-sub">{sub}</div>}
      </div>
      <div className="panel-shell-body">{children}</div>
      <div className="panel-shell-foot">{foot}</div>
    </div>
  );
}
