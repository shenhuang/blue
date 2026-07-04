import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// dev 工作台（独立 sibling 根·与游戏 App 解耦·lazy 加载·不进游戏主包）：
//   ?editor / ?editor=<tool>  dev 工作台（EditorApp·6 工具按域分组：事件/剧情·战斗·地图）
//   ?storyeditor              旧别名 → 工作台 story tab（回退兼容）
//   裸 ?editor                → 海图 tab（保住旧 ?editor＝海图书签）
// EditorApp 内部按 URL 选初始 tab 并 lazy() 各工具；详见 docs/spec/深海回响_dev工作台_SPEC.md
const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const isWorkbench = params.has('editor') || params.has('storyeditor');
const EditorApp = lazy(() => import('./ui/EditorApp'));

// dev UI 预览（?dev&scene=<id>·仅 ?dev 门下生效）：把真实 App 一启动就落在任意画面、注入用真实引擎
// 构造器造的合法 state（渲真实 UI＝逐像素保真·预览 ephemeral 不落盘）。fixture/装配全在 lazy chunk
// ScenePreview（src/ui/dev/scenes）·不进游戏主包；main.tsx 不受 game↛dev 边界扫描（check-boundaries 规则五）。
const sceneId = params.has('dev') ? params.get('scene') : null;
const ScenePreview = lazy(() => import('./ui/dev/scenes/ScenePreview'));

function Root() {
  if (isWorkbench) {
    return (
      <Suspense fallback={null}>
        <EditorApp />
      </Suspense>
    );
  }
  if (sceneId) {
    return (
      <Suspense fallback={null}>
        <ScenePreview sceneId={sceneId} />
      </Suspense>
    );
  }
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
