// dev 工作台壳（布局壳·纯展示）：左 nav rail（按域分组）+ 右 content 区。
// 状态/路由由 EditorApp 持有；本组件只渲染导航与当前内容。
// 详见 docs/spec/深海回响_dev工作台_SPEC.md

import type { ReactNode } from 'react';
import './editor-shell.css';

export interface EditorNavItem {
  key: string;
  label: string;
}
export interface EditorNavGroup {
  group: string;
  items: EditorNavItem[];
}

interface Props {
  nav: EditorNavGroup[];
  active: string;
  onSelect: (key: string) => void;
  children: ReactNode;
}

export function EditorShell({ nav, active, onSelect, children }: Props) {
  return (
    <div className="editor-shell">
      <nav className="editor-nav" aria-label="dev 工作台导航">
        <div className="editor-nav-brand">深海回响 · dev 工作台</div>
        {nav.map((g) => (
          <div className="editor-nav-group" key={g.group}>
            <div className="editor-nav-grouphead">{g.group}</div>
            {g.items.map((it) => (
              <button
                key={it.key}
                type="button"
                className={`editor-nav-item${active === it.key ? ' on' : ''}`}
                aria-current={active === it.key ? 'page' : undefined}
                onClick={() => onSelect(it.key)}
              >
                {it.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="editor-content">{children}</div>
    </div>
  );
}
