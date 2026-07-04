// UI 预览装配（dev·懒 chunk·仅 ?dev&scene= 下载·不进游戏主包）。
//
// 由 main.tsx 在 ?dev&scene=<id> 时装配：查注册表拿 SceneDef → build() 造合法 state →
// 交**真实 App** 渲染（initialState 顶替存档、ephemeral 不落盘）。渲的就是玩家那套 UI＝逐像素保真。
//
// 边界：本文件在 src/ui/dev 下＝dev 工具，import 游戏 App 属 dev→game（check-boundaries 规则五只禁
// game→dev·反向允许）；只由 main.tsx（不受扫描）引入。App 侧不 import 本目录，边界不破。

import App from '@/App';
import { SCENE_MAP, SCENES } from './registry';

export default function ScenePreview({ sceneId }: { sceneId: string }) {
  const def = SCENE_MAP[sceneId];

  // 单一真相：把注册表场景清单挂到 window，供 shoot 脚本 --all 枚举（见 scripts/shoot.mjs）。
  if (typeof window !== 'undefined') {
    (window as Window & { __BLUE_SCENES__?: { id: string; label: string }[] }).__BLUE_SCENES__ =
      SCENES.map((s) => ({ id: s.id, label: s.label }));
  }

  if (!def) {
    return (
      <div className="scene-preview-unknown" style={{ padding: 24, fontFamily: 'monospace', color: '#cdd6e0', lineHeight: 1.7 }}>
        <h2 style={{ margin: '0 0 12px' }}>未知 scene：{sceneId}</h2>
        <p style={{ margin: '0 0 8px', opacity: 0.8 }}>可用场景（?dev&amp;scene=&lt;id&gt;）：</p>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {SCENES.map((s) => (
            <li key={s.id}>
              <code style={{ color: '#7fd' }}>{s.id}</code> — {s.label}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return <App initialState={def.build()} ephemeral />;
}
